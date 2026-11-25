import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root, NotConfiguredScreen } from './App';
import { createRuntime } from './runtime';
import { ThemeProvider } from './lib/theme';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

void createRuntime().then((runtime) => {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      {runtime.ok ? (
        <Root runtime={runtime} />
      ) : (
        <ThemeProvider>
          <NotConfiguredScreen reason={runtime.reason} />
        </ThemeProvider>
      )}
    </StrictMode>,
  );
});
