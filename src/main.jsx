import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

document.body.classList.add('jimu-tech-theme');

const root = createRoot(document.getElementById('root'));
root.render(<App />);
