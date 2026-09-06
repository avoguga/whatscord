import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type ClientRect,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Announcements,
  type ScreenReaderInstructions
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fileUrl } from "../lib/api";
import { initials } from "../lib/format";
import { useStore, type Space, type SpaceFolder } from "../store";
import { FolderModal } from "./FolderModal";
import { Trans, useLingui } from "@lingui/react/macro";

/**
 * O rail de espaços: arrastar para reordenar, arrastar por cima para agrupar.
 *
 * Três decisões que valem registro:
 *
 *  1. `@dnd-kit` e não HTML5 drag-and-drop. O arrastar nativo não existe em
 *     toque nenhum e não tem caminho de teclado — seria um recurso só de mouse
 *     de desktop. O dnd-kit traz sensor de teclado pronto (pegar com espaço,
 *     mover com as setas), que é o que torna isto usável sem mouse.
 *
 *  2. O sensor de toque tem ATRASO, não distância. Com ativação por distância,
 *     o primeiro pixel de rolagem no celular vira um arraste e a lista trava
 *     na mão de quem só queria descer. 220 ms com 8 px de tolerância deixa a
 *     rolagem passar e ainda responde rápido a quem segurou de propósito.
 *
 *  3. Fundir é um gesto de MIRA, reordenar é um gesto de POSIÇÃO. Só solta
 *     dentro da pasta quem parou perto do centro do alvo; qualquer coisa mais
 *     acima ou mais abaixo é reordenar. Sem essa faixa morta, toda tentativa de
 *     passar um ícone por cima de outro criaria uma pasta sem querer.
 */

/** Uma linha do rail, já achatada: a pasta e o que está aberto dentro dela. */
type Slot =
  | { kind: "space"; id: string; space: Space }
  | { kind: "folder"; id: string; folder: SpaceFolder };

/** Uma pasta nunca entra noutra: a fusão só faz sentido com um espaço na mão. */
function ehEspaco(slot: Slot | undefined): slot is Extract<Slot, { kind: "space" }> {
  return slot?.kind === "space";
}

function centroPerto(a: ClientRect | null | undefined, b: ClientRect | null | undefined) {
  if (!a || !b) return false;
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - (b.top + b.height / 2);
  // Vale para o rail em pé (desktop) e deitado (celular): as duas medidas são
  // conferidas, e a que não é o eixo da lista dá quase zero de qualquer jeito.
  return Math.abs(dx) < b.width * 0.55 && Math.abs(dy) < b.height * 0.45;
}

/*
 * O ponteiro manda quando está sobre alguma coisa; fora dela, vale o centro
 * mais próximo. Só `closestCenter` faz o alvo saltar para o vizinho no meio de
 * um gesto lento, e só `pointerWithin` deixa o arraste sem alvo nenhum quando a
 * mão sai da coluna estreita do rail.
 */
const colisao: CollisionDetection = (args) => {
  const sobre = pointerWithin(args);
  return sobre.length > 0 ? sobre : closestCenter(args);
};

/**
 * O rail deita abaixo de 560 px — vira uma barra no rodapé, como no WhatsApp.
 *
 * Isto não é enfeite: a estratégia de ordenação do dnd-kit decide para que lado
 * os vizinhos se afastam para abrir espaço. Com a vertical num rail deitado, os
 * ícones se empurram para cima e para baixo enquanto o dedo anda para o lado, e
 * o arraste fica impossível de mirar exatamente no aparelho onde ele é mais
 * difícil. `matchMedia` e não `innerWidth` porque isto tem de acompanhar o giro
 * da tela sem recarregar.
 */
function useRailDeitado() {
  const [deitado, setDeitado] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 560px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 560px)");
    const ouvir = () => setDeitado(mq.matches);
    mq.addEventListener("change", ouvir);
    ouvir();
    return () => mq.removeEventListener("change", ouvir);
  }, []);
  return deitado;
}

export function SpaceRail() {
  const { t } = useLingui();
  const deitado = useRailDeitado();
  const spaces = useStore((s) => s.spaces);
  const folders = useStore((s) => s.spaceFolders);
  const openFolders = useStore((s) => s.openFolders);
  const activeSpaceId = useStore((s) => s.activeSpaceId);
  const setActiveSpace = useStore((s) => s.setActiveSpace);
  const toggleFolder = useStore((s) => s.toggleFolder);
  const reorderSpaces = useStore((s) => s.reorderSpaces);
  const createSpaceFolder = useStore((s) => s.createSpaceFolder);
  const updateSpaceFolder = useStore((s) => s.updateSpaceFolder);
  const notify = useStore((s) => s.notify);

  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvoFusao, setAlvoFusao] = useState<string | null>(null);
  const [pastaEmEdicao, setPastaEmEdicao] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: "space" | "folder" } | null>(null);
  /* O último alvo de fusão calculado no movimento, para `onDragEnd` não ter
     que refazer a conta com um retângulo que já mudou de lugar. */
  const fusaoRef = useRef<string | null>(null);

  const { slots, topo, dentroDe } = useMemo(() => {
    const conhecidas = new Set(folders.map((f) => f.id));
    const dentroDe = new Map<string, Space[]>();
    for (const f of folders) dentroDe.set(f.id, []);

    const soltos: Space[] = [];
    for (const s of spaces) {
      // Uma pasta que sumiu (apagada noutro aparelho) não pode levar o espaço
      // junto: sem este `conhecidas`, o ícone simplesmente não seria desenhado.
      if (s.folderId && conhecidas.has(s.folderId)) dentroDe.get(s.folderId)!.push(s);
      else soltos.push(s);
    }

    const topo: Slot[] = [
      ...soltos.map((s): Slot => ({ kind: "space", id: s.id, space: s })),
      ...folders.map((f): Slot => ({ kind: "folder", id: f.id, folder: f }))
    ].sort((a, b) => {
      const pa = a.kind === "space" ? (a.space.position ?? 0) : a.folder.position;
      const pb = b.kind === "space" ? (b.space.position ?? 0) : b.folder.position;
      // Empate resolvido pela pasta primeiro, sempre igual: uma ordem que muda
      // de render em render faz o ícone piscar de lugar sozinho.
      return pa - pb || (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1);
    });

    const slots: Slot[] = [];
    for (const item of topo) {
      slots.push(item);
      if (item.kind === "folder" && openFolders.has(item.folder.id)) {
        for (const s of dentroDe.get(item.folder.id)!) {
          slots.push({ kind: "space", id: s.id, space: s });
        }
      }
    }
    return { slots, topo, dentroDe };
  }, [spaces, folders, openFolders]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      /*
       * Espaço pega e solta; Enter fica com o botão.
       *
       * O padrão do dnd-kit é começar o arraste com Espaço OU Enter, e como
       * cada ícone daqui é um `<button>`, isso roubava a única tecla que abre
       * um espaço pelo teclado — dava para reordenar sem mouse e não dava mais
       * para ENTRAR num espaço sem mouse. Trocar por um caminho pior que o
       * anterior não é acessibilidade.
       */
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] }
    })
  );

  const nomeDoSlot = (id: string | null | undefined) => {
    const slot = slots.find((s) => s.id === id);
    if (!slot) return "";
    return slot.kind === "space" ? slot.space.name : slot.folder.name;
  };

  /*
   * O que o leitor de tela narra. O padrão do dnd-kit é em inglês e fala de
   * "sortable item", que não quer dizer nada para quem está arrastando um
   * servidor de conversa — e ainda ficaria em inglês num app traduzido.
   */
  const instrucoes: ScreenReaderInstructions = {
    draggable: t`Press space to pick this up, then the arrow keys to move it and space again to drop it. Press escape to leave it where it was. Press enter to open it instead.`
  };

  const anuncios: Announcements = {
    onDragStart: ({ active }) => {
      const nome = nomeDoSlot(String(active.id));
      return t`Picked up ${nome}. Use the arrow keys to move it, space to drop it, escape to cancel.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const nome = nomeDoSlot(String(active.id));
      const alvo = nomeDoSlot(String(over.id));
      return t`${nome} is over ${alvo}.`;
    },
    onDragEnd: ({ active, over }) => {
      const nome = nomeDoSlot(String(active.id));
      if (!over) return t`${nome} was left where it was.`;
      const alvo = nomeDoSlot(String(over.id));
      return t`${nome} was dropped at ${alvo}.`;
    },
    onDragCancel: ({ active }) => {
      const nome = nomeDoSlot(String(active.id));
      return t`Moving ${nome} was cancelled.`;
    }
  };

  function aoIniciar(e: DragStartEvent) {
    setArrastando(String(e.active.id));
    fusaoRef.current = null;
    setAlvoFusao(null);
  }

  function aoMover(e: DragMoveEvent) {
    const ativo = slots.find((s) => s.id === String(e.active.id));
    const sobre = e.over ? slots.find((s) => s.id === String(e.over!.id)) : undefined;

    const podeFundir =
      ehEspaco(ativo) &&
      sobre !== undefined &&
      sobre.id !== ativo.id &&
      centroPerto(e.active.rect.current.translated, e.over?.rect);

    const alvo = podeFundir ? sobre!.id : null;
    fusaoRef.current = alvo;
    setAlvoFusao(alvo);
  }

  async function aoTerminar(e: DragEndEvent) {
    const ativoId = String(e.active.id);
    const alvoFusaoId = fusaoRef.current;
    setArrastando(null);
    setAlvoFusao(null);
    fusaoRef.current = null;

    if (!e.over) return;
    const sobreId = String(e.over.id);
    if (sobreId === ativoId && !alvoFusaoId) return;

    const ativo = slots.find((s) => s.id === ativoId);
    if (!ativo) return;

    try {
      if (alvoFusaoId && ehEspaco(ativo)) {
        await fundir(ativo.space, alvoFusaoId);
      } else if (ativo.kind === "folder") {
        await moverPasta(ativoId, sobreId);
      } else {
        await moverEspaco(ativo.space, sobreId);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : t`That could not be saved.`, "bad");
    }
  }

  /** Solta um espaço em cima de outro: vira pasta. Em cima de pasta: entra. */
  async function fundir(espaco: Space, alvoId: string) {
    const alvo = slots.find((s) => s.id === alvoId);
    if (!alvo) return;

    if (alvo.kind === "folder") {
      const dentro = dentroDe.get(alvo.folder.id) ?? [];
      await reorderSpaces([
        ...dentro.map((s, i) => ({ spaceId: s.id, position: i, folderId: alvo.folder.id })),
        { spaceId: espaco.id, position: dentro.length, folderId: alvo.folder.id }
      ]);
      const nome = alvo.folder.name;
      notify(t`Moved to ${nome}.`);
      return;
    }

    const outro = alvo.space;
    if (outro.folderId) {
      // O alvo já mora numa pasta: entrar nela é o que a pessoa quis, e criar
      // uma pasta dentro de outra não é coisa que este rail saiba desenhar.
      const dentro = dentroDe.get(outro.folderId) ?? [];
      await reorderSpaces([
        ...dentro.map((s, i) => ({ spaceId: s.id, position: i, folderId: outro.folderId! })),
        { spaceId: espaco.id, position: dentro.length, folderId: outro.folderId! }
      ]);
      return;
    }

    await createSpaceFolder(t`New folder`, null, [outro.id, espaco.id]);
    notify(t`Folder created. Open it to give it a name and a colour.`);
  }

  /** Uma pasta anda inteira, com o que está dentro; ela nunca entra noutra. */
  async function moverPasta(pastaId: string, sobreId: string) {
    const de = topo.findIndex((s) => s.id === pastaId);
    const sobreSlot = slots.find((s) => s.id === sobreId);
    const alvoTopo =
      sobreSlot && ehEspaco(sobreSlot) && sobreSlot.space.folderId
        ? sobreSlot.space.folderId
        : sobreId;
    const para = topo.findIndex((s) => s.id === alvoTopo);
    if (de < 0 || para < 0 || de === para) return;

    const novo = [...topo];
    novo.splice(para, 0, novo.splice(de, 1)[0]);
    await salvar(novo);
  }

  /** Um espaço herda a pasta de quem ficou logo acima dele. */
  async function moverEspaco(espaco: Space, sobreId: string) {
    const de = slots.findIndex((s) => s.id === espaco.id);
    const para = slots.findIndex((s) => s.id === sobreId);
    if (de < 0 || para < 0 || de === para) return;

    const novo = [...slots];
    novo.splice(para, 0, novo.splice(de, 1)[0]);

    const anterior = novo[para - 1];
    const novaPasta =
      anterior === undefined
        ? null
        : anterior.kind === "folder"
          ? // Logo abaixo do cabeçalho de uma pasta ABERTA é o primeiro lugar
            // dentro dela; abaixo de uma fechada é depois dela, do lado de fora.
            openFolders.has(anterior.folder.id)
            ? anterior.folder.id
            : null
          : (anterior.space.folderId ?? null);

    await salvar(novo, { espacoId: espaco.id, pasta: novaPasta });
  }

  /**
   * Converte a lista achatada em posições e manda para o servidor.
   *
   * Só o espaço movido troca de pasta; todos os outros ficam com a pasta que já
   * tinham. Deduzir a pasta de cada um pela vizinhança faria o vizinho de baixo
   * de uma pasta aberta ser engolido por ela sem ninguém ter arrastado nada.
   */
  async function salvar(novo: Slot[], movido?: { espacoId: string; pasta: string | null }) {
    const pastaDe = (slot: Slot): string | null => {
      if (slot.kind !== "space") return null;
      if (movido && slot.id === movido.espacoId) return movido.pasta;
      return slot.space.folderId ?? null;
    };

    let posTopo = 0;
    const contador = new Map<string, number>();
    const items: { spaceId: string; position: number; folderId: string | null }[] = [];
    const posicoesDePasta = new Map<string, number>();

    for (const slot of novo) {
      if (slot.kind === "folder") {
        posicoesDePasta.set(slot.folder.id, posTopo++);
        continue;
      }
      const pasta = pastaDe(slot);
      if (pasta) {
        const n = contador.get(pasta) ?? 0;
        contador.set(pasta, n + 1);
        items.push({ spaceId: slot.id, position: n, folderId: pasta });
      } else {
        items.push({ spaceId: slot.id, position: posTopo++, folderId: null });
      }
    }

    /*
     * O que está dentro de uma pasta fechada — ou de qualquer pasta, quando o
     * que se moveu foi a pasta inteira — não aparece em `novo`. Esses espaços
     * entram aqui com a ordem que já tinham: mandar ao servidor só metade da
     * lista apagaria a ordem de quem estava escondido.
     */
    const presentes = new Set(novo.filter((s) => s.kind === "space").map((s) => s.id));
    for (const f of folders) {
      const faltando = (dentroDe.get(f.id) ?? []).filter((s) => !presentes.has(s.id));
      const base = contador.get(f.id) ?? 0;
      faltando.forEach((s, i) => items.push({ spaceId: s.id, position: base + i, folderId: f.id }));
    }

    /*
     * As duas metades saem JUNTAS, não uma depois da outra.
     *
     * Espaços e pastas dividem a mesma régua de posições no topo da barra, e
     * salvar a ordem dos espaços primeiro e esperar a resposta antes de mexer
     * na pasta deixava meio segundo de uma ordem que ninguém pediu na tela —
     * com a pasta ainda na posição antiga, entre dois ícones que já andaram.
     * As duas ações mudam a tela na hora, então `Promise.all` faz as duas
     * mudanças caírem no mesmo quadro.
     */
    const pastasQueAndaram = folders.filter((f) => {
      const nova = posicoesDePasta.get(f.id);
      return nova !== undefined && nova !== f.position;
    });

    await Promise.all([
      reorderSpaces(items),
      ...pastasQueAndaram.map((f) =>
        updateSpaceFolder(f.id, { position: posicoesDePasta.get(f.id)! })
      )
    ]);
  }

  const slotArrastado = slots.find((s) => s.id === arrastando);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={colisao}
        accessibility={{ announcements: anuncios, screenReaderInstructions: instrucoes }}
        onDragStart={aoIniciar}
        onDragMove={aoMover}
        onDragEnd={(e) => void aoTerminar(e)}
        onDragCancel={() => {
          setArrastando(null);
          setAlvoFusao(null);
          fusaoRef.current = null;
        }}
      >
        <SortableContext
          items={slots.map((s) => s.id)}
          strategy={deitado ? horizontalListSortingStrategy : verticalListSortingStrategy}
        >
          {slots.map((slot) =>
            slot.kind === "folder" ? (
              <PastaChip
                key={slot.id}
                pasta={slot.folder}
                dentro={dentroDe.get(slot.folder.id) ?? []}
                aberta={openFolders.has(slot.folder.id)}
                alvo={alvoFusao === slot.id}
                temAtivo={(dentroDe.get(slot.folder.id) ?? []).some((s) => s.id === activeSpaceId)}
                onToggle={() => toggleFolder(slot.folder.id)}
                onMenu={() => setMenu({ id: slot.folder.id, kind: "folder" })}
              />
            ) : (
              <EspacoChip
                key={slot.id}
                espaco={slot.space}
                dentroDePasta={Boolean(slot.space.folderId)}
                ativo={activeSpaceId === slot.space.id}
                alvo={alvoFusao === slot.id}
                onOpen={() => setActiveSpace(slot.space.id)}
                onMenu={() => setMenu({ id: slot.space.id, kind: "space" })}
              />
            )
          )}
        </SortableContext>

        {/*
          O clone que segue o cursor. Sem ele, o item arrastado fica preso
          dentro do rail, que tem `overflow` no celular — e some da tela no meio
          do gesto.
        */}
        <DragOverlay>
          {slotArrastado ? (
            <div className="rail-drag">
              {slotArrastado.kind === "space" ? (
                <EscudoDoEspaco espaco={slotArrastado.space} />
              ) : (
                <MiniaturasDaPasta
                  pasta={slotArrastado.folder}
                  dentro={dentroDe.get(slotArrastado.folder.id) ?? []}
                />
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {menu && (
        <MenuDoRail
          alvo={menu}
          onClose={() => setMenu(null)}
          onEditarPasta={(id) => {
            setMenu(null);
            setPastaEmEdicao(id);
          }}
        />
      )}

      {pastaEmEdicao && (
        <FolderModal
          folderId={pastaEmEdicao}
          onClose={() => setPastaEmEdicao(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------ os ícones */

function EscudoDoEspaco({ espaco }: { espaco: Space }) {
  return espaco.iconUrl ? (
    <img className="rail-avatar" src={fileUrl(espaco.iconUrl)} alt="" />
  ) : (
    <>{initials(espaco.name)}</>
  );
}

function EspacoChip({
  espaco, ativo, alvo, dentroDePasta, onOpen, onMenu
}: {
  espaco: Space;
  ativo: boolean;
  alvo: boolean;
  dentroDePasta: boolean;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: espaco.id
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`space-chip${dentroDePasta ? " in-folder" : ""}${alvo ? " merge" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      data-tip={espaco.name}
      /*
       * Depois do espalhamento de propósito: o dnd-kit também escreve
       * `aria-pressed` enquanto arrasta, e deixar o dele por cima faria a barra
       * parar de dizer qual espaço está aberto.
       */
      aria-pressed={ativo}
      onClick={onOpen}
      onContextMenu={(e) => {
        // Também é o caminho de teclado: Shift+F10 e a tecla de menu disparam
        // este mesmo evento, então quem não usa mouse chega às pastas.
        e.preventDefault();
        onMenu();
      }}
    >
      <EscudoDoEspaco espaco={espaco} />
    </button>
  );
}

function MiniaturasDaPasta({ pasta, dentro }: { pasta: SpaceFolder; dentro: Space[] }) {
  return (
    <span className="folder-mini" style={pasta.color ? { background: pasta.color } : undefined}>
      {/* Uma pasta vazia é possível: o último espaço pode ter saído dela. Sem
          este desenho de reserva o ícone ficaria um quadrado em branco. */}
      {dentro.length === 0 ? (
        <span className="folder-mini-empty" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
            />
          </svg>
        </span>
      ) : (
        dentro.slice(0, 4).map((s) => (
          <span key={s.id} className="folder-mini-cell">
            {s.iconUrl ? <img src={fileUrl(s.iconUrl)} alt="" /> : initials(s.name).slice(0, 1)}
          </span>
        ))
      )}
    </span>
  );
}

function PastaChip({
  pasta, dentro, aberta, alvo, temAtivo, onToggle, onMenu
}: {
  pasta: SpaceFolder;
  dentro: Space[];
  aberta: boolean;
  alvo: boolean;
  temAtivo: boolean;
  onToggle: () => void;
  onMenu: () => void;
}) {
  const { t } = useLingui();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pasta.id
  });
  const nome = pasta.name;

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rail-folder${aberta ? " open" : ""}${alvo ? " merge" : ""}${temAtivo ? " has-active" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        ...(pasta.color ? { ["--folder-color" as string]: pasta.color } : {})
      }}
      data-tip={nome}
      aria-expanded={aberta}
      aria-label={aberta ? t`Close the folder ${nome}` : t`Open the folder ${nome}`}
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
    >
      {aberta ? (
        <span className="folder-open-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="currentColor"
              d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V6Zm0 4h18l-1.6 8.4A2 2 0 0 1 17.4 20H6.6a2 2 0 0 1-2-1.6L3 10Z"
            />
          </svg>
        </span>
      ) : (
        <MiniaturasDaPasta pasta={pasta} dentro={dentro} />
      )}
    </button>
  );
}

/* --------------------------------------------------------------- o menu */

/**
 * O caminho que não depende de arrastar.
 *
 * Criar pasta arrastando é o gesto do Discord e é o que a maioria vai usar, mas
 * ele é impossível com teclado e desconfortável com leitor de tela. Este menu
 * faz as mesmas três coisas — criar pasta, entrar numa, sair — por uma lista de
 * botões, e abre com a tecla de menu do teclado além do botão direito.
 */
function MenuDoRail({
  alvo, onClose, onEditarPasta
}: {
  alvo: { id: string; kind: "space" | "folder" };
  onClose: () => void;
  onEditarPasta: (id: string) => void;
}) {
  const { t } = useLingui();
  const spaces = useStore((s) => s.spaces);
  const folders = useStore((s) => s.spaceFolders);
  const reorderSpaces = useStore((s) => s.reorderSpaces);
  const createSpaceFolder = useStore((s) => s.createSpaceFolder);
  const notify = useStore((s) => s.notify);

  const espaco = spaces.find((s) => s.id === alvo.id);
  const pasta = folders.find((f) => f.id === alvo.id);

  async function mover(pastaId: string | null) {
    if (!espaco) return;
    const irmaos = spaces.filter((s) => (s.folderId ?? null) === pastaId && s.id !== espaco.id);
    try {
      await reorderSpaces([
        ...irmaos.map((s, i) => ({ spaceId: s.id, position: i, folderId: pastaId })),
        { spaceId: espaco.id, position: irmaos.length, folderId: pastaId }
      ]);
      const nome = folders.find((f) => f.id === pastaId)?.name;
      notify(nome ? t`Moved to ${nome}.` : t`Moved out of the folder.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : t`That could not be saved.`, "bad");
    }
    onClose();
  }

  return (
    <div className="rail-menu-scrim" onMouseDown={onClose}>
      <div
        className="pop-menu rail-menu"
        role="menu"
        aria-label={t`Organise spaces`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {espaco && (
          <>
            <button
              role="menuitem"
              autoFocus
              onClick={async () => {
                try {
                  await createSpaceFolder(t`New folder`, null, [espaco.id]);
                  notify(t`Folder created.`);
                } catch (err) {
                  notify(err instanceof Error ? err.message : t`That could not be saved.`, "bad");
                }
                onClose();
              }}
            >
              <Trans>New folder with this space</Trans>
            </button>
            {folders
              .filter((f) => f.id !== espaco.folderId)
              .map((f) => {
                // O nome sai para uma constante porque o macro do Lingui só
                // vira marcador o que é identificador simples; `f.name` dentro
                // do `t` viraria um `{0}` sem nome nenhum no catálogo.
                const nome = f.name;
                return (
                  <button key={f.id} role="menuitem" onClick={() => void mover(f.id)}>
                    {t`Move to ${nome}`}
                  </button>
                );
              })}
            {espaco.folderId && (
              <button role="menuitem" onClick={() => void mover(null)}>
                <Trans>Move out of the folder</Trans>
              </button>
            )}
          </>
        )}

        {pasta && (
          <button role="menuitem" autoFocus onClick={() => onEditarPasta(pasta.id)}>
            <Trans>Folder settings</Trans>
          </button>
        )}

        <button role="menuitem" onClick={onClose}>
          <Trans>Cancel</Trans>
        </button>
      </div>
    </div>
  );
}
