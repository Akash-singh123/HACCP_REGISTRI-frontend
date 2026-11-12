// Librerie PDF/ZIP pesanti, riesportate da un modulo dedicato.
//
// Chi ne ha bisogno le richiede con un import dinamico RELATIVO
// (import('./pdfLibs')): uno specificatore "nudo" come import('jspdf') non
// viene risolto da tutti gli ambienti di esecuzione (errore "Failed to resolve
// module specifier 'jspdf'"). Il dynamic import relativo mantiene comunque
// jspdf e jszip fuori dal bundle iniziale.
import jsPDF from 'jspdf';
import JSZip from 'jszip';

export { jsPDF, JSZip };
