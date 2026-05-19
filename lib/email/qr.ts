const QR_VERSION = 8;
const QR_SIZE = QR_VERSION * 4 + 17;
const DATA_CODEWORDS_PER_BLOCK = 97;
const BLOCK_COUNT = 2;
const ECC_CODEWORDS_PER_BLOCK = 24;
const DATA_CODEWORDS = DATA_CODEWORDS_PER_BLOCK * BLOCK_COUNT;
const TOTAL_CODEWORDS = 242;
const QUIET_ZONE = 4;
const PAD_CODEWORDS = [0xec, 0x11];
const ALIGNMENT_POSITIONS = [6, 24, 42];

type Matrix = boolean[][];

const gfExp: number[] = [];
const gfLog: number[] = Array(256).fill(0);

let value = 1;
for (let index = 0; index < 255; index += 1) {
  gfExp[index] = value;
  gfLog[value] = index;
  value <<= 1;
  if (value & 0x100) {
    value ^= 0x11d;
  }
}
for (let index = 255; index < 512; index += 1) {
  gfExp[index] = gfExp[index - 255];
}

function gfMultiply(left: number, right: number) {
  if (left === 0 || right === 0) return 0;
  return gfExp[gfLog[left] + gfLog[right]];
}

function polynomialMultiply(left: number[], right: number[]) {
  const output = Array(left.length + right.length - 1).fill(0);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      output[leftIndex + rightIndex] ^= gfMultiply(left[leftIndex], right[rightIndex]);
    }
  }
  return output;
}

function reedSolomonGenerator(degree: number) {
  let generator = [1];
  for (let index = 0; index < degree; index += 1) {
    generator = polynomialMultiply(generator, [1, gfExp[index]]);
  }
  return generator;
}

const eccGenerator = reedSolomonGenerator(ECC_CODEWORDS_PER_BLOCK);

function reedSolomonRemainder(data: number[]) {
  const remainder = Array(ECC_CODEWORDS_PER_BLOCK).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[remainder.length - 1] = 0;
    for (let index = 0; index < remainder.length; index += 1) {
      remainder[index] ^= gfMultiply(eccGenerator[index + 1], factor);
    }
  }
  return remainder;
}

function pushBits(bits: number[], value: number, width: number) {
  for (let index = width - 1; index >= 0; index -= 1) {
    bits.push((value >>> index) & 1);
  }
}

function dataCodewordsFor(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 192) {
    throw new Error("QR payload is too long for Collie's email QR encoder.");
  }

  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, 8);
  for (const byte of bytes) {
    pushBits(bits, byte, 8);
  }

  const remainingBits = DATA_CODEWORDS * 8 - bits.length;
  pushBits(bits, 0, Math.min(4, remainingBits));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      byte = (byte << 1) | bits[index + bit];
    }
    codewords.push(byte);
  }

  for (let index = 0; codewords.length < DATA_CODEWORDS; index += 1) {
    codewords.push(PAD_CODEWORDS[index % PAD_CODEWORDS.length]);
  }

  return codewords;
}

function interleaveBlocks(dataCodewords: number[]) {
  const dataBlocks = Array.from({ length: BLOCK_COUNT }, (_, blockIndex) =>
    dataCodewords.slice(
      blockIndex * DATA_CODEWORDS_PER_BLOCK,
      (blockIndex + 1) * DATA_CODEWORDS_PER_BLOCK,
    ),
  );
  const eccBlocks = dataBlocks.map((block) => reedSolomonRemainder(block));
  const output: number[] = [];

  for (let index = 0; index < DATA_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of dataBlocks) {
      output.push(block[index]);
    }
  }
  for (let index = 0; index < ECC_CODEWORDS_PER_BLOCK; index += 1) {
    for (const block of eccBlocks) {
      output.push(block[index]);
    }
  }

  return output;
}

function emptyMatrix() {
  const modules = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false));
  const reserved = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false));
  return { modules, reserved };
}

function setModule(modules: Matrix, reserved: Matrix, row: number, col: number, dark: boolean, isFunction = true) {
  if (row < 0 || col < 0 || row >= QR_SIZE || col >= QR_SIZE) return;
  modules[row][col] = dark;
  if (isFunction) {
    reserved[row][col] = true;
  }
}

function drawFinder(modules: Matrix, reserved: Matrix, row: number, col: number) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const targetRow = row + y;
      const targetCol = col + x;
      const isFinder =
        x >= 0 &&
        x <= 6 &&
        y >= 0 &&
        y <= 6 &&
        (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
      setModule(modules, reserved, targetRow, targetCol, isFinder);
    }
  }
}

function drawAlignment(modules: Matrix, reserved: Matrix, row: number, col: number) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      setModule(modules, reserved, row + y, col + x, distance !== 1);
    }
  }
}

function drawFunctionPatterns(modules: Matrix, reserved: Matrix) {
  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, 0, QR_SIZE - 7);
  drawFinder(modules, reserved, QR_SIZE - 7, 0);

  for (let index = 8; index < QR_SIZE - 8; index += 1) {
    const dark = index % 2 === 0;
    setModule(modules, reserved, 6, index, dark);
    setModule(modules, reserved, index, 6, dark);
  }

  for (const row of ALIGNMENT_POSITIONS) {
    for (const col of ALIGNMENT_POSITIONS) {
      const overlapsFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === QR_SIZE - 7) ||
        (row === QR_SIZE - 7 && col === 6);
      if (!overlapsFinder) {
        drawAlignment(modules, reserved, row, col);
      }
    }
  }

  setModule(modules, reserved, QR_VERSION * 4 + 9, 8, true);
  reserveFormatAreas(reserved);
  reserveVersionAreas(reserved);
}

function reserveFormatAreas(reserved: Matrix) {
  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][QR_SIZE - 1 - index] = true;
    reserved[QR_SIZE - 1 - index][8] = true;
  }
}

function reserveVersionAreas(reserved: Matrix) {
  for (let index = 0; index < 6; index += 1) {
    for (let offset = 0; offset < 3; offset += 1) {
      reserved[index][QR_SIZE - 11 + offset] = true;
      reserved[QR_SIZE - 11 + offset][index] = true;
    }
  }
}

function maskApplies(row: number, col: number) {
  return (row + col) % 2 === 0;
}

function drawData(modules: Matrix, reserved: Matrix, codewords: number[]) {
  const bits = codewords.flatMap((byte) =>
    Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1),
  );
  let bitIndex = 0;
  let upward = true;

  for (let rightCol = QR_SIZE - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol -= 1;
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const row = upward ? QR_SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = rightCol - offset;
        if (reserved[row][col]) continue;
        const dark = (bits[bitIndex] ?? 0) === 1;
        modules[row][col] = maskApplies(row, col) ? !dark : dark;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function bchRemainder(value: number, polynomial: number, degree: number) {
  let remainder = value << degree;
  for (let index = mostSignificantBit(remainder) - degree; index >= 0; index -= 1) {
    if (((remainder >>> (index + degree)) & 1) !== 0) {
      remainder ^= polynomial << index;
    }
  }
  return remainder;
}

function mostSignificantBit(value: number) {
  let bit = 0;
  while (value !== 0) {
    value >>>= 1;
    bit += 1;
  }
  return bit;
}

function drawFormatBits(modules: Matrix, reserved: Matrix) {
  const errorCorrectionLevel = 0b01;
  const maskPattern = 0;
  const data = (errorCorrectionLevel << 3) | maskPattern;
  const formatBits = ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412;

  for (let index = 0; index <= 5; index += 1) {
    setModule(modules, reserved, 8, index, ((formatBits >>> index) & 1) !== 0);
  }
  setModule(modules, reserved, 8, 7, ((formatBits >>> 6) & 1) !== 0);
  setModule(modules, reserved, 8, 8, ((formatBits >>> 7) & 1) !== 0);
  setModule(modules, reserved, 7, 8, ((formatBits >>> 8) & 1) !== 0);
  for (let index = 9; index < 15; index += 1) {
    setModule(modules, reserved, 14 - index, 8, ((formatBits >>> index) & 1) !== 0);
  }

  for (let index = 0; index < 8; index += 1) {
    setModule(modules, reserved, QR_SIZE - 1 - index, 8, ((formatBits >>> index) & 1) !== 0);
  }
  for (let index = 8; index < 15; index += 1) {
    setModule(modules, reserved, 8, QR_SIZE - 15 + index, ((formatBits >>> index) & 1) !== 0);
  }
}

function drawVersionBits(modules: Matrix, reserved: Matrix) {
  const versionBits = (QR_VERSION << 12) | bchRemainder(QR_VERSION, 0x1f25, 12);
  for (let index = 0; index < 18; index += 1) {
    const bit = ((versionBits >>> index) & 1) !== 0;
    const row = Math.floor(index / 3);
    const col = QR_SIZE - 11 + (index % 3);
    setModule(modules, reserved, row, col, bit);
    setModule(modules, reserved, col, row, bit);
  }
}

export function qrMatrixFor(value: string) {
  const { modules, reserved } = emptyMatrix();
  drawFunctionPatterns(modules, reserved);
  drawData(modules, reserved, interleaveBlocks(dataCodewordsFor(value)));
  drawFormatBits(modules, reserved);
  drawVersionBits(modules, reserved);
  return modules;
}

export function qrSvgFor(value: string) {
  const matrix = qrMatrixFor(value);
  const size = QR_SIZE + QUIET_ZONE * 2;
  const path = matrix
    .flatMap((row, rowIndex) =>
      row.map((dark, colIndex) =>
        dark ? `M${colIndex + QUIET_ZONE} ${rowIndex + QUIET_ZONE}h1v1h-1z` : "",
      ),
    )
    .filter(Boolean)
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`,
    `<path fill="#fff" d="M0 0h${size}v${size}H0z"/>`,
    `<path fill="#111827" d="${path}"/>`,
    "</svg>",
  ].join("");
}

export function qrDataUriFor(value: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvgFor(value))}`;
}

export function qrImageMarkup(value: string, size = 180) {
  const dataUri = qrDataUriFor(value);
  return `<img src="${dataUri}" width="${size}" height="${size}" alt="QR code" style="display:block;border:0;width:${size}px;height:${size}px" />`;
}

export const qrPayloadLimit = 192;
export const qrModuleSize = QR_SIZE;
export const qrTotalCodewords = TOTAL_CODEWORDS;
