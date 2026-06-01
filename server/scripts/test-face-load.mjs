import { resolvePythonBin, getPythonCandidates } from '../src/face/python.ts';
import { loadFaceModels, isFaceRecognitionAvailable, getFaceLoadError } from '../src/face/service.ts';

console.log('candidates:', getPythonCandidates().filter((p) => p.includes('venv') || p.includes('PYTHON')));
console.log('resolved:', await resolvePythonBin());
const ok = await loadFaceModels();
console.log('load:', ok, 'available:', isFaceRecognitionAvailable(), 'error:', getFaceLoadError());
