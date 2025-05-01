import { useState } from 'react'
import axios from 'axios'
import { Container } from 'react-bootstrap'
import QRScanner from './components/QRScanner'

function App() {
  const [response, setResponse] = useState(null)

  const submitHandler = async (text, fileExtension) => {
    console.log('submitting')
    // e.preventDefault()
    try {
      const res = await axios.post('/api/submit', { text, fileExtension })
      setResponse(res.data.message)
    } catch (err) {
      setResponse('Error: ' + err.message)
    }
    console.log(text)
  }

  return (
    <Container>
      <h1>This is it!</h1>
      <QRScanner onSubmit={submitHandler} />
    </Container>
  )
}

export default App
