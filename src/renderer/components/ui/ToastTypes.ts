export type ToastTone = 'success' | 'error' | 'info';
export interface ToastMessage { id: string; tone: ToastTone; title: string; detail?: string }
