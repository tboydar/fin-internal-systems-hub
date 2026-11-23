import '@fontsource/encode-sans-semi-condensed/latin-400.css';
import '@fontsource/encode-sans-semi-condensed/latin-600.css';
import './styles/main.css';
import { $ } from './ui/dom';
import { mountShell } from './ui/shell';

mountShell($('#app'));
