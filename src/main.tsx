import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App, readOptions } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(<App options={readOptions()} />);
