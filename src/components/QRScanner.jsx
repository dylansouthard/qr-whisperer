import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Container, Button, Alert, Form, Row, Col } from 'react-bootstrap'

const QRScanner = ({ onSubmit }) => {
  const videoRef = useRef(null)
  const canvasRef = useRef(null) // overlay for boxes
  const streamRef = useRef(null)

  const [scannedChunks, setScannedChunks] = useState({})
  const [totalParts, setTotalParts] = useState(null)
  const [status, setStatus] = useState('ready to scan...')
  const [fullText, setFullText] = useState(null)
  const [ready, setReady] = useState(false)
  const [fileExtension, setFileExtension] = useState('')

  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const [zoomAvailable, setZoomAvailable] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [zoomMin, setZoomMin] = useState(1)
  const [zoomMax, setZoomMax] = useState(1)

  const [usingBarcodeDetector, setUsingBarcodeDetector] = useState(false)

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
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const handleSubmit = () => {
    if (onSubmit && fullText) onSubmit(fullText, fileExtension)
  }

  // enumerate cameras for device picker
  useEffect(() => {
    async function enumerate() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        const vids = all.filter((d) => d.kind === 'videoinput')
        setDevices(vids)
        // try to pick a likely rear camera if none selected yet
        if (!selectedDeviceId) {
          const rear = vids.find((d) => /back|rear|environment/i.test(d.label))
          setSelectedDeviceId(rear?.deviceId || vids[0]?.deviceId || '')
        }
      } catch (e) {
        // ignore
      }
    }
    enumerate()
    navigator.mediaDevices?.addEventListener?.('devicechange', enumerate)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', enumerate)
  }, [selectedDeviceId])

  // draw rectangles on the overlay canvas
  const drawBoxes = (boxes = []) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')

    // match canvas to video element size
    const { videoWidth, videoHeight } = video
    canvas.width = videoWidth || video.clientWidth
    canvas.height = videoHeight || video.clientHeight

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // draw targeting reticle (subtle guidance even without detections)
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    const pad = Math.min(canvas.width, canvas.height) * 0.1
    const w = canvas.width - pad * 2
    const h = canvas.height - pad * 2
    ctx.strokeRect(pad, pad, w, h)

    // highlight detected boxes
    ctx.lineWidth = 4
    boxes.forEach((b) => {
      const { x, y, width, height } = b
      ctx.strokeStyle = 'rgba(0,200,0,0.9)'
      ctx.strokeRect(x, y, width, height)
    })
  }

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  const applyTrackFeatures = (track) => {
    try {
      const caps = track.getCapabilities?.()
      const settings = track.getSettings?.()
      // Torch
      if (caps && 'torch' in caps) setTorchAvailable(true)
      else setTorchAvailable(false)

      // Zoom
      if (caps && 'zoom' in caps) {
        setZoomAvailable(true)
        const min = caps.zoom.min ?? 1
        const max = caps.zoom.max ?? (settings?.zoom || 1)
        const cur = settings?.zoom || min
        setZoomMin(min)
        setZoomMax(max)
        setZoom(cur)
      } else {
        setZoomAvailable(false)
        setZoomMin(1)
        setZoomMax(1)
        setZoom(1)
      }

      // try continuous autofocus if supported
      if (caps?.focusMode && caps.focusMode.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
      }
    } catch (e) {
      // best-effort only
    }
  }

  const setTorch = async (on) => {
    setTorchOn(on)
    const track = streamRef.current?.getVideoTracks?.()[0]
    try {
      await track?.applyConstraints?.({ advanced: [{ torch: !!on }] })
    } catch (e) {
      // ignore if unsupported
    }
  }

  const setZoomConstraint = async (value) => {
    setZoom(value)
    const track = streamRef.current?.getVideoTracks?.()[0]
    try {
      await track?.applyConstraints?.({ advanced: [{ zoom: Number(value) }] })
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    if (!ready) return

    let cancelled = false
    let zxingReader = null

    async function start() {
      stopStream()

      const constraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (cancelled) return
        streamRef.current = stream
        const [track] = stream.getVideoTracks()
        applyTrackFeatures(track)

        const video = videoRef.current
        video.srcObject = stream
        await video.play().catch(() => {})

        // Prefer BarcodeDetector (fast, native, gives boxes). Fallback to ZXing.
        const supported = 'BarcodeDetector' in window
        setUsingBarcodeDetector(!!supported)

        if (supported) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
          let rafId
          const loop = async () => {
            if (cancelled) return
            try {
              const codes = await detector.detect(video)
              if (codes && codes.length) {
                // draw boxes and parse first result
                drawBoxes(codes.map((c) => c.boundingBox))
                const text = codes[0].rawValue
                const parsed = parseQRChunk(text)
                if (parsed) {
                  const { part, total, content } = parsed
                  if (!totalParts) setTotalParts(total)
                  setScannedChunks((prev) => (prev[part] ? prev : { ...prev, [part]: content }))
                } else if (text) {
                  // allow single-QR mode (not chunked)
                  if (!fullText) {
                    setTotalParts(1)
                    setScannedChunks((prev) => (prev[1] ? prev : { ...prev, 1: text }))
                  }
                }
              } else {
                drawBoxes([])
              }
            } catch (e) {
              // continue
            }
            rafId = requestAnimationFrame(loop)
          }
          loop()

          return () => cancelAnimationFrame(rafId)
        } else {
          // ZXing fallback
          zxingReader = new BrowserQRCodeReader()
          await zxingReader.decodeFromStream(stream, video, (result) => {
            if (cancelled || !result) return
            // no boxes available in this API; still draw guidance reticle
            drawBoxes([])
            const text = result.getText()
            const parsed = parseQRChunk(text)
            if (parsed) {
              const { part, total, content } = parsed
              if (!totalParts) setTotalParts(total)
              setScannedChunks((prev) => (prev[part] ? prev : { ...prev, [part]: content }))
            } else if (text) {
              if (!fullText) {
                setTotalParts(1)
                setScannedChunks((prev) => (prev[1] ? prev : { ...prev, 1: text }))
              }
            }
          })
        }
      } catch (err) {
        console.error('Failed to start camera:', err)
        setStatus('🚫 Failed to start camera. Check browser permissions.')
      }
    }

    const cleanup = start()

    return () => {
      cancelled = true
      if (zxingReader) {
        try {
          zxingReader.reset()
        } catch (e) {}
      }
      stopStream()
      if (typeof cleanup === 'function') cleanup()
    }
  }, [ready, selectedDeviceId])

  useEffect(() => {
    if (totalParts && Object.keys(scannedChunks).length === totalParts) {
      const full = Array.from({ length: totalParts }, (_, i) => scannedChunks[i + 1]).join('')
      setFullText(full)
      setStatus('✅ All parts scanned and assembled!')
    } else if (totalParts) {
      const remaining = totalParts - Object.keys(scannedChunks).length
      setStatus(`📦 ${Object.keys(scannedChunks).length} / ${totalParts} parts scanned (${remaining} remaining)`)
    }
  }, [scannedChunks, totalParts])

  // turn torch off when leaving
  useEffect(() => () => setTorch(false), [])

  return (
    <Container className='mt-4'>
      <h2>📷 QR Scanner {usingBarcodeDetector ? '(fast mode)' : '(compat mode)'} </h2>

      {!fullText && (
        <div style={{ position: 'relative' }}>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{ width: '100%', borderRadius: 8, display: 'block' }}
          />
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />
        </div>
      )}

      <Alert variant='info' className='mt-3'>
        {status}
      </Alert>

      {!fullText && (
        <>
          <Row className='mb-3'>
            <Col md={6} className='mb-2'>
              <Form.Select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                aria-label='Camera source'
              >
                {devices.length === 0 && <option value=''>Default camera</option>}
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Camera'}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col md={3} className='mb-2'>
              <Button
                variant={torchOn ? 'warning' : 'secondary'}
                disabled={!torchAvailable}
                onClick={() => setTorch(!torchOn)}
                style={{ width: '100%' }}
              >
                {torchOn ? '🔦 Torch ON' : '🔦 Torch'}
              </Button>
            </Col>
            <Col md={3} className='mb-2'>
              <Form.Range
                min={zoomMin}
                max={zoomMax}
                step={(zoomMax - zoomMin) / 50 || 1}
                value={zoom}
                disabled={!zoomAvailable}
                onChange={(e) => setZoomConstraint(e.target.value)}
              />
            </Col>
          </Row>
        </>
      )}

      {fullText && (
        <>
          <Form.Group className='mb-3'>
            <Form.Label>Assembled Text</Form.Label>
            <Form.Control as='textarea' rows={6} value={fullText} readOnly />
          </Form.Group>
          <Form.Group className='mb-3'>
            <Form.Control
              type='text'
              placeholder='file extension'
              value={fileExtension}
              onChange={(e) => setFileExtension(e.target.value)}
            />
          </Form.Group>
          <div className='mb-3'>
            <Button variant='primary' className='me-3' onClick={handleSubmit} disabled={!fileExtension}>
              Submit Assembled Text
            </Button>
            <Button variant='danger' onClick={clearAll}>
              Clear all and try again
            </Button>
          </div>
        </>
      )}
    </Container>
  )
}

export default QRScanner
