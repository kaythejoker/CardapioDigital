import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

// Helvetica includes Portuguese characters. Keep unsupported decorative symbols out of PDF text.
const printable = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, " ");
export async function tableQrPdf(
  restaurant: { name: string; slug: string },
  tables: { label: string; qr_token: string }[],
  origin: string,
  /** Domínio próprio do restaurante: caminho curto /m/{qr}. */
  short = false,
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`QR das mesas - ${printable(restaurant.name)}`);
  for (let offset = 0; offset < tables.length; offset += 6) {
    const page = pdf.addPage([595.28, 841.89]);
    const title = printable(restaurant.name);
    const titleSize = Math.min(
      18,
      527 / Math.max(bold.widthOfTextAtSize(title, 1), 1),
    );
    page.drawText(title, {
      x: 34,
      y: 805,
      size: titleSize,
      font: bold,
      color: rgb(0.12, 0.1, 0.09),
    });
    page.drawText("QR codes das mesas - recorte nas linhas", {
      x: 34,
      y: 783,
      size: 10,
      font,
    });
    for (const [index, table] of tables.slice(offset, offset + 6).entries()) {
      const x = 34 + (index % 2) * 270;
      const y = 525 - Math.floor(index / 2) * 244;
      page.drawRectangle({
        x,
        y,
        width: 257,
        height: 230,
        borderColor: rgb(0.8, 0.76, 0.7),
        borderWidth: 0.5,
      });
      const label = printable(`Mesa ${table.label}`);
      const size = Math.min(
        18,
        220 / Math.max(bold.widthOfTextAtSize(label, 1), 1),
      );
      page.drawText(label, {
        x: x + (257 - bold.widthOfTextAtSize(label, size)) / 2,
        y: y + 203,
        size,
        font: bold,
      });
      const url = short ? `${origin}/m/${table.qr_token}` : `${origin}/${restaurant.slug}/m/${table.qr_token}`;
      const image = await pdf.embedPng(
        await QRCode.toBuffer(url, {
          width: 450,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      );
      page.drawImage(image, { x: x + 52, y: y + 42, width: 153, height: 153 });
      page.drawText("Escaneie para ver o cardápio", {
        x: x + 61,
        y: y + 28,
        size: 10,
        font,
      });
      page.drawText("Peça o código ao garçom para pedir", {
        x: x + 47,
        y: y + 13,
        size: 9,
        font,
      });
    }
  }
  return pdf.save();
}
