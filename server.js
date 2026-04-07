import express from 'express'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const app = express()

app.use(express.raw({ type: 'application/pdf', limit: '10mb' }))

app.post('/compress', async (req, res) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-'))
  const input = path.join(tmpDir, 'in.pdf')
  const output = path.join(tmpDir, 'out.pdf')

  try {
    await fs.writeFile(input, req.body)

    await new Promise((resolve, reject) => {
      execFile('gs', [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dPDFSETTINGS=/ebook',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOutputFile=${output}`,
        input
      ], (err) => err ? reject(err) : resolve())
    })

    const result = await fs.readFile(output)
    res.setHeader('Content-Type', 'application/pdf')
    res.send(result)

  } catch (err) {
    res.status(500).json({ error: 'Compression failed' })
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Running on port ${PORT}`))