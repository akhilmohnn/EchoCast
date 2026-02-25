import { Routes, Route } from 'react-router-dom'
import { Landing, CreateRoomPage, JoinRoomPage, RoomConnectedPage, GoLivePage } from './pages'
import { AudioStreamProvider } from './context/AudioStreamContext'
import FloatingStreamWidget from './components/FloatingStreamWidget/FloatingStreamWidget'
import './App.css'

function App() {
  return (
    <AudioStreamProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<CreateRoomPage />} />
        <Route path="/join" element={<JoinRoomPage />} />
        <Route path="/connected" element={<RoomConnectedPage />} />
        <Route path="/golive" element={<GoLivePage />} />
        <Route path="*" element={<Landing />} />
      </Routes>
      {/* Rendered via portal onto document.body — floats above all pages */}
      <FloatingStreamWidget />
    </AudioStreamProvider>
  )
}

export default App
