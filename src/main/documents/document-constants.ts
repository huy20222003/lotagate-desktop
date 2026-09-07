export type DocumentFormat = 'pdf' | 'pptx' | 'excel' | 'docs';
export const DOCUMENT_BACKEND_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const DOCUMENT_BACKEND_TIMEOUT_MS = 10 * 60 * 1_000;
export const FORMAT_EXTENSIONS: Record<DocumentFormat, readonly string[]> = { pdf: ['.pdf'], pptx: ['.pptx'], excel: ['.xlsx', '.xls', '.csv'], docs: ['.docx', '.doc', '.txt', '.rtf'] };
