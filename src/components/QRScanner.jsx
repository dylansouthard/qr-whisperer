import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Container, Button, Alert, Form } from 'react-bootstrap'

const QRScanner = ({ onSubmit }) => {
  const videoRef = useRef(null)
  const [scannedChunks, setScannedChunks] = useState({})
  const [totalParts, setTotalParts] = useState(null)
  const [status, setStatus] = useState('ready to scan...')
  const [fullText, setFullText] = useState(null)
  const [ready, setReady] = useState(false)
  const [fileExtension, setFileExtension] = useState(null)

  const parseQRChunk = (text) => {
    const match = text.match(/^<<PART (\d+) of (\d+)>>([\s\S]*)/)
    if (!match) return null
    return {
      part: parseInt(match[1]),
      total: parseInt(match[2]),
      content: match[3].trim(),
    }
  }

  const clearAll = () => {
    setScannedChunks({})
    setTotalParts(null)
    setStatus('ready to scan...')
    setFullText(null)
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current) {
        setReady(true)
        clearInterval(interval)
      }
    }, 100) // poll every 100ms

    return () => clearInterval(interval)
  }, [])

  const handleSubmit = () => {
    console.log('handling submit')
    if (onSubmit && fullText) onSubmit(fullText, fileExtension)
  }

  useEffect(() => {
    if (!ready) return
    const codeReader = new BrowserQRCodeReader()
    let stopped = false
    let currentStream = null

    async function startScan() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        videoRef.current.srcObject = stream
        currentStream = stream

        await codeReader.decodeFromStream(stream, videoRef.current, (result, err) => {
          if (stopped) return

          if (result) {
            const text = result.getText()
            const parsed = parseQRChunk(text)
            if (parsed) {
              const { part, total, content } = parsed
              if (!totalParts) setTotalParts(total)
              console.log(`setting total parts to ${total}`)
              setScannedChunks((prev) => {
                if (prev[part]) return prev
                return { ...prev, [part]: content }
              })
            }
          }
        })
      } catch (err) {
        console.error('Failed to start camera:', err)
        setStatus('🚫 Failed to start camera. Check browser permissions.')
      }
    }

    startScan()

    return () => {
      stopped = true
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [totalParts, ready])

  useEffect(() => {
    console.log('checking for total parts')
    console.log(`tp = ${totalParts} && lengthe is ${Object.keys(scannedChunks).length} === totalParts`)
    if (totalParts && Object.keys(scannedChunks).length === totalParts) {
      console.log('total parts are finished!')
      const full = Array.from({ length: totalParts }, (_, i) => scannedChunks[i + 1]).join('')
      console.log(`setting full text to ${full}`)
      setFullText(full)
      setStatus('✅ All parts scanned and assembled!')
    } else if (totalParts) {
      const remaining = totalParts - Object.keys(scannedChunks).length
      setStatus(`📦 ${Object.keys(scannedChunks).length} / ${totalParts} parts scanned (${remaining} remaining)`)
    }
  }, [scannedChunks, totalParts])

  return (
    <Container className='mt-4'>
      <h2>📷 QR Scanner</h2>
      {!fullText && <video ref={videoRef} muted playsInline autoPlay style={{ width: '100%' }} />}

      <Alert variant='info' className='mt-3'>
        {status}
      </Alert>
      {fullText && (
        <>
          <Form.Group className='mb-3'>
            <Form.Label>Assembled Text</Form.Label>
            <Form.Control as='textarea' rows={6} value={fullText} readOnly />
          </Form.Group>
          <Form.Group>
            <Form.Control
              type='text'
              placeholder='file extension'
              value={fileExtension}
              onChange={(e) => setFileExtension(e.target.value)}
            />
            <Button variant='primary' className='mr-3' onClick={handleSubmit} disabled={!fileExtension}>
              Submit Assembled Text
            </Button>
          </Form.Group>

          <Button variant='danger' onClick={clearAll}>
            Clear all and try again
          </Button>
        </>
      )}
    </Container>
  )
}

export default QRScanner
