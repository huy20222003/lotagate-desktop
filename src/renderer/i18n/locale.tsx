import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export type Language = 'en' | 'vi';
export type MessageKey = 'checkingSession' | 'signInTitle' | 'signInCopy' | 'emailOrUsername' | 'password' | 'signIn' | 'signingIn' | 'sessionProtected' | 'apiUnavailable' | 'sessionExpired';
const messages: Record<Language, Record<MessageKey, string>> = {
  en: { checkingSession: 'Checking session', signInTitle: 'Sign in to continue', signInCopy: 'Connect your account to start working with LotaGate Agent.', emailOrUsername: 'Email or username', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in', sessionProtected: 'Your session is protected by the LotaGate API.', apiUnavailable: 'Unable to connect to the LotaGate API.', sessionExpired: 'Your session expired. Please sign in again.' },
  vi: { checkingSession: 'Đang kiểm tra phiên', signInTitle: 'Đăng nhập để tiếp tục', signInCopy: 'Kết nối tài khoản để bắt đầu làm việc với LotaGate Agent.', emailOrUsername: 'Email hoặc tên đăng nhập', password: 'Mật khẩu', signIn: 'Đăng nhập', signingIn: 'Đang đăng nhập', sessionProtected: 'Phiên của bạn được bảo vệ bởi LotaGate API.', apiUnavailable: 'Không thể kết nối tới LotaGate API.', sessionExpired: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' },
};

interface LocaleContextValue { language: Language; setLanguage: (language: Language) => Promise<void>; t: (key: MessageKey) => string; }
const LocaleContext = createContext<LocaleContextValue>({ language: 'en', setLanguage: async () => undefined, t: key => messages.en[key] });

export function LocaleProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<Language>('en');
  useEffect(() => { void window.lotagate.settings.get().then(value => { const loaded = value['language']; if (loaded === 'en' || loaded === 'vi') setLanguageState(loaded); }).catch(() => undefined); }, []);
  const value = useMemo<LocaleContextValue>(() => ({ language, setLanguage: async next => { await window.lotagate.settings.update({ language: next }); setLanguageState(next); }, t: key => messages[language][key] }), [language]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue { return useContext(LocaleContext); }
