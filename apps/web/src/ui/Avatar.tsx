import { fileUrl } from "../lib/api";
import { initials } from "../lib/format";

/**
 * Um avatar: a imagem quando existe, as iniciais quando não.
 *
 * Antes disso, `avatarUrl` existia no banco e no tipo mas **só era renderizado
 * num lugar** — o ícone da própria conta no rail. Em todo o resto do app o
 * código chamava `initials(...)` direto, então uma foto de perfil não apareceria
 * na lista de conversas, no cabeçalho, no roster da chamada nem em lugar nenhum.
 *
 * Concentrar isso aqui é o que faz a foto aparecer nos onze lugares de uma vez.
 */
export function Avatar({
  name,
  url,
  size = 40,
  className = "avatar",
  online
}: {
  name: string;
  url?: string | null;
  /** Lado em pixels. O componente é quadrado; o arredondamento vem do CSS. */
  size?: number;
  className?: string;
  online?: boolean;
}) {
  const style = { width: size, height: size, flexBasis: size, fontSize: Math.round(size * 0.36) };

  return (
    <span className={className} style={style}>
      {url ? (
        /*
         * `alt` vazio de propósito: o nome já está escrito ao lado em todos os
         * usos, e repetir vira ruído para quem usa leitor de tela.
         */
        <img src={fileUrl(url)} alt="" loading="lazy" />
      ) : (
        initials(name)
      )}
      {online && <span className="presence-dot" />}
    </span>
  );
}
