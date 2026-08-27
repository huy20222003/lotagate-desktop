import { createContext } from 'react';
import type { ToastMessage } from './ToastTypes.js';

export interface ToastContextValue { show: (message: Omit<ToastMessage, 'id'>) => void; success: (title: string, detail?: string) => void; error: (title: string, detail?: string) => void; info: (title: string, detail?: string) => void }
export const ToastContext = createContext<ToastContextValue | undefined>(undefined);
