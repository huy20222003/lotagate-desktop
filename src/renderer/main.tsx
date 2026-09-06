import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './styles/index.css';
import { LocaleProvider } from './i18n/locale.js';
import { ToastProvider } from './components/ui.js';
import { ThemeProvider } from './theme/theme.js';
import { AppErrorBoundary } from './components/error-boundary.js';

const root = document.getElementById('root');
if (!root) throw new Error('Desktop renderer root is missing.');

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary><ThemeProvider><LocaleProvider><ToastProvider><App /></ToastProvider></LocaleProvider></ThemeProvider></AppErrorBoundary>
  </StrictMode>,
);
