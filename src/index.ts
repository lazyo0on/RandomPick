import './localization';
import { Roulette } from './roulette';
import options from './options';
import { MapEditor } from './editor/editor';

const roulette = new Roulette();

// eslint-disable-next-line
(window as any).roullete = roulette;
// eslint-disable-next-line
(window as any).options = options;
// Used by the page script to open the editor overlay.
// eslint-disable-next-line
(window as any).MapEditor = MapEditor;
