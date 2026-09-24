const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Little-endian fields of 2 or 4 bytes, then a file name. */
function record(
  fields: [value: number, bytes: 2 | 4][],
  name = new Uint8Array(),
) {
  const size = fields.reduce((total, [, bytes]) => total + bytes, 0)
  const buffer = new Uint8Array(size + name.length)
  const view = new DataView(buffer.buffer)
  let at = 0
  for (const [value, bytes] of fields) {
    if (bytes === 2) view.setUint16(at, value, true)
    else view.setUint32(at, value, true)
    at += bytes
  }
  buffer.set(name, size)
  return buffer
}

/** A ZIP archive of text files, stored uncompressed; sites are small. */
export function zip(files: Record<string, string>) {
  const encoder = new TextEncoder()
  const now = new Date()
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate()
  const entries: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path)
    const data = encoder.encode(content)
    // Version 2.0, UTF-8 names, stored.
    const shared: [number, 2 | 4][] = [
      [20, 2],
      [0x0800, 2],
      [0, 2],
      [time, 2],
      [date, 2],
      [crc32(data), 4],
      [data.length, 4],
      [data.length, 4],
      [name.length, 2],
      [0, 2],
    ]
    const header = record([[0x04034b50, 4], ...shared], name)
    directory.push(
      record(
        [
          [0x02014b50, 4],
          [20, 2],
          ...shared,
          [0, 2],
          [0, 2],
          [0, 2],
          [0, 4],
          [offset, 4],
        ],
        name,
      ),
    )
    entries.push(header, data)
    offset += header.length + data.length
  }
  const size = directory.reduce((total, entry) => total + entry.length, 0)
  const end = record([
    [0x06054b50, 4],
    [0, 2],
    [0, 2],
    [directory.length, 2],
    [directory.length, 2],
    [size, 4],
    [offset, 4],
    [0, 2],
  ])
  return new Blob([...entries, ...directory, end] as BlobPart[], {
    type: 'application/zip',
  })
}
