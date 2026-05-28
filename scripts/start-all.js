import { spawn } from 'node:child_process';

console.log('🚀 Starting both backend and frontend services...');

// Set environment for backend port explicitly
process.env.PORT = '24011';

const backend = spawn('node', ['backend/dist/index.js'], { 
  stdio: 'inherit', 
  shell: true 
});

const frontend = spawn('npm', ['run', 'preview', '-w', 'frontend'], { 
  stdio: 'inherit', 
  shell: true 
});

const cleanup = (code) => {
  console.log('🛑 Shutting down concurrent services...');
  backend.kill();
  frontend.kill();
  process.exit(code || 0);
};

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

backend.on('exit', (code) => {
  console.log(`Backend process exited with code ${code}`);
  cleanup(code);
});

frontend.on('exit', (code) => {
  console.log(`Frontend process exited with code ${code}`);
  cleanup(code);
});
