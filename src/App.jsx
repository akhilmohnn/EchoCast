import { Routes, Route } from 'react-router-dom'
import { Landing, CreateRoomPage, JoinRoomPage, RoomConnectedPage, GoLivePage } from './pages'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/create" element={<CreateRoomPage />} />
      <Route path="/join" element={<JoinRoomPage />} />
      <Route path="/connected" element={<RoomConnectedPage />} />
      <Route path="/golive" element={<GoLivePage />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  )
}

export default App
