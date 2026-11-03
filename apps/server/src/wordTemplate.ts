/** Template Word (.docx) untuk impor soal — WordprocessingML minimal yang dibangkitkan di server. */
import JSZip from 'jszip';
import { WORD_TEMPLATE } from './importer.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function para(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}) {
  const rpr = [opts.bold ? '<w:b/>' : '', opts.italic ? '<w:i/>' : '', opts.color ? `<w:color w:val="${opts.color}"/>` : '', opts.size ? `<w:sz w:val="${opts.size}"/>` : ''].join('');
  return `<w:p><w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

export async function templateDocx(): Promise<Buffer> {
  const intro = [
    'Petunjuk: setiap soal diawali baris "Soal:". Pisahkan soal dengan satu baris kosong.',
    'Pilihan ganda: tulis opsi A. B. C. D. (E.) lalu "Kunci: B".',
    'Benar/Salah: "Tipe: BS" dan "Kunci: Benar" atau "Kunci: Salah".',
    'Isian: "Tipe: ISIAN" dan "Kunci: jawaban1 | jawaban2".',
    'Menjodohkan: "Tipe: JODOH" lalu baris 1. kiri = kanan, 2. kiri = kanan, …',
    'Opsional: Pembahasan:, Mapel:, Kelas:, Fase:, Materi:, Capaian:, Kesulitan:, Poin:, Dunia:',
  ];
  const body = [
    para('Template Soal EDUVERSE', { bold: true, size: 36, color: '1E2A4A' }),
    ...intro.map((t) => para(t, { italic: true, color: '55607A' })),
    para(''),
    ...WORD_TEMPLATE.split('\n').map((l) => para(l)),
  ].join('');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
