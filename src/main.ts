import './ui/styles.css';
import { App } from './app';
import { readOptions } from './config';

const options = readOptions();
const app = new App(document.getElementById('app')!, options);
void app.start();

if (options.debug) (window as unknown as { app: App }).app = app;
