import express from 'express'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const app = express()

app.use(express.raw({ type: 'application/pdf', limit: '10mb' }))

let activeJobs = 0
const MAX_JOBS = 1

app.post('/compress', async (req, res) => {
  const startedAt = Date.now()

  // --- validate early (before taking a slot) ---
  if (!req.headers['content-type']?.includes('application/pdf')) {
    return res.status(400).send('Invalid content type')
  }

  if (!req.body || req.body.length === 0) {
    return res.status(400).send('Empty body')
  }

  // --- concurrency gate ---
  if (activeJobs >= MAX_JOBS) {
    return res.status(503).send('Server is busy')
  }
  activeJobs++

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-'))
  const input = path.join(tmpDir, 'in.pdf')
  const output = path.join(tmpDir, 'out.pdf')

  try {
    console.log({
      event: 'compress_start',
      inputBytes: req.body.length
    })

    await fs.writeFile(input, req.body)

    await new Promise((resolve, reject) => {
      execFile(
        'gs',
        [
          '-sDEVICE=pdfwrite',
          '-dCompatibilityLevel=1.4',
          '-dPDFSETTINGS=/ebook',
          '-dNOPAUSE',
          '-dQUIET',
          '-dBATCH',
          `-sOutputFile=${output}`,
          input
        ],
        { timeout: 15000 },
        (err, stdout, stderr) => {
          if (err) {
            if (err.code === 'ETIMEDOUT' || err.killed) {
              return reject(new Error('Ghostscript timeout'))
            }
            return reject(new Error(`Ghostscript error: ${err.message}`))
          }
          resolve()
        }
      )
    })

    const result = await fs.readFile(output)

    console.log({
      event: 'compress_success',
      inputBytes: req.body.length,
      outputBytes: result.length,
      compressionRatio: req.body.length
      ? (result.length / req.body.length).toFixed(2)
      : null,
      durationMs: Date.now() - startedAt
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(result.length))
    res.setHeader('Content-Disposition', 'inline; filename="compressed.pdf"')
    res.send(result)
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === 'Ghostscript timeout'

    console.error({
      event: 'compress_error',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt
    })

    if (isTimeout) {
      return res.status(504).json({ error: 'Compression timed out' })
    }

    return res.status(500).json({ error: 'Compression failed' })
  } finally {
    activeJobs--
    //or activeJobs = Math.max(0, activeJobs - 1)
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

const PORT = process.env.PORT || 10000

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PDF Compressor is running on port ${PORT}`)
})