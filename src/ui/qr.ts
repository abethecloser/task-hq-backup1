// QR codes for links a person opens on their phone (setup links, check-in badges).
import qrcode from 'qrcode-generator';

export function qrSvg(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
