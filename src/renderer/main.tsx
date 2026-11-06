import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useApp } from './store'
import './styles.css'

void useApp.getState().init()
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
