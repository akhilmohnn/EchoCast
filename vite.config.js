import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    basicSsl(),   // Self-signed HTTPS — required for getDisplayMedia on LAN
  ],
  server: {
    host: true, // Expose on all network interfaces (0.0.0.0)
    https: true,
  },
})
