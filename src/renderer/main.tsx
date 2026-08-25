import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './styles/theme.css';
import { LocaleProvider } from './i18n/locale.js';

const root = document.getElementById('root');
if (!root) throw new Error('Desktop renderer root is missing.');

createRoot(root).render(
  <StrictMode>
    <LocaleProvider><App /></LocaleProvider>
  </StrictMode>,
);
