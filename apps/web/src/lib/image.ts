/**
 * Redimensionamento de imagem no navegador, para avatar e ícone.
 *
 * O upload (`POST /files`) é genérico: aceita qualquer tipo, não valida que é
 * imagem e **não redimensiona**. Sem isto, um avatar escolhido do celular —
 * facilmente 4 MB e 4000 px — seria servido inteiro em cada linha da lista de
 * conversas.
 *
 * Resolver no navegador em vez de no servidor evita acrescentar uma biblioteca
 * de processamento de imagem à API, e ainda economiza a subida do arquivo
 * grande. O custo é depender de `createImageBitmap` e `canvas`, que existem em
 * tudo que roda este app.
 */

/**
 * Lado máximo de um avatar ou ícone, em pixels.
 *
 * Era 256. Bastava para a bolinha da lista, mas a foto também abre grande
 * (`FotoAmpliada`), e 256 px esticados numa tela de 1080 ficam borrados.
 * 640 em JPEG 0,88 dá uns 50 KB: mais do que os ~15 KB de antes em cada linha
 * da lista, mas o cabeçalho de cache é `immutable` e cada foto baixa uma vez.
 * Fotos enviadas antes desta mudança continuam com 256 até serem trocadas.
 */
export const AVATAR_SIZE = 640;

export class ImageError extends Error {}

/**
 * Corta no centro e reduz para um quadrado de `size`.
 *
 * Corte central em vez de esticar: um retrato de corpo inteiro vira o rosto, não
 * uma pessoa achatada. É o que qualquer app faz com foto de perfil.
 */
export async function squareThumbnail(file: File, size = AVATAR_SIZE): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new ImageError("Choose an image file.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Arquivo com extensão de imagem mas conteúdo quebrado chega aqui.
    throw new ImageError("That image could not be read.");
  }

  try {
    const lado = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - lado) / 2;
    const sy = (bitmap.height - lado) / 2;

    // Nunca aumentar: uma imagem de 64 px não melhora esticada para 256.
    const alvo = Math.min(size, lado);

    const canvas = document.createElement("canvas");
    canvas.width = alvo;
    canvas.height = alvo;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageError("This browser cannot resize the image.");

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, lado, lado, 0, 0, alvo, alvo);

    /*
     * PNG preserva transparência mas pesa muito numa foto. JPEG é o certo para
     * foto e é o caso comum de avatar; quem sobe um PNG com fundo transparente
     * ganha fundo preto, que é o comportamento do canvas — aceitável para um
     * avatar redondo, onde o fundo é recortado de qualquer jeito.
     */
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88)
    );
    if (!blob) throw new ImageError("That image could not be processed.");

    const nome = file.name.replace(/\.[^.]+$/, "") || "avatar";
    return new File([blob], `${nome}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
