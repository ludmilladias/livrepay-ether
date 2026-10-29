import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * reCAPTCHA v2 (checkbox). Sem VITE_RECAPTCHA_SITE_KEY o componente não renderiza
 * nada e o servidor (sem RECAPTCHA_SECRET) também não exige o token. A chave de
 * SITE é pública por natureza; o segredo fica só no servidor.
 */
export const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

interface Grecaptcha {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => number;
  reset: (id?: number) => void;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    __recaptchaReady?: () => void;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.grecaptcha?.render) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    window.__recaptchaReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://www.google.com/recaptcha/api.js?onload=__recaptchaReady&render=explicit";
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Não foi possível carregar o reCAPTCHA"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface RecaptchaHandle {
  reset: () => void;
}

interface Props {
  /** Token válido (string) ou null quando expira/falha/é reiniciado. */
  onChange: (token: string | null) => void;
}

export const Recaptcha = forwardRef<RecaptchaHandle, Props>(function Recaptcha({ onChange }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    reset() {
      onChangeRef.current(null);
      if (widgetId.current !== null) window.grecaptcha?.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!RECAPTCHA_SITE_KEY || !box.current) return;
    let cancelled = false;
    const el = box.current;
    loadScript()
      .then(() => {
        if (cancelled || widgetId.current !== null || !window.grecaptcha) return;
        widgetId.current = window.grecaptcha.render(el, {
          sitekey: RECAPTCHA_SITE_KEY,
          callback: (token) => onChangeRef.current(token),
          "expired-callback": () => onChangeRef.current(null),
          "error-callback": () => onChangeRef.current(null),
        });
      })
      .catch(() => onChangeRef.current(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!RECAPTCHA_SITE_KEY) return null;
  return <div ref={box} className="flex justify-center" aria-label="Verificação reCAPTCHA" />;
});
