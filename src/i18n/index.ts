import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import React, { useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import en from './en';
import hi from './hi';
import ta from './ta';
import te from './te';
import mr from './mr';
import bn from './bn';
import gu from './gu';
import kn from './kn';

// Universal edition: global languages. Screen text comes from tr_global.ts;
// these i18next resources cover the few keyed strings, the rest fall back to English.
const es = { translation: { app: { name: 'SaloonBossX', tagline: 'Gestiona • Crece • Brilla' }, nav: { home: 'Inicio', book: 'Reservar', bill: 'Factura', clients: 'Clientes', more: 'Más' },
  common: { success: 'Listo', save: 'Guardar', cancel: 'Cancelar', ok: 'OK', done: 'Listo', back: 'Atrás', next: 'Siguiente' }, terms: { title: 'Términos y condiciones' }, privacy: { title: 'Política de privacidad' },
  activation: { choosePlan: 'Elige tu plan', bestValue: 'Mejor valor ⭐', haveKey: '¿Ya tienes una clave de licencia?', activated: '¡Activado! Bienvenido a SaloonBossX', buyNow: 'Comprar ahora' } } };
const pt = { translation: { app: { name: 'SaloonBossX', tagline: 'Gerencie • Cresça • Brilhe' }, nav: { home: 'Início', book: 'Agendar', bill: 'Conta', clients: 'Clientes', more: 'Mais' },
  common: { success: 'Pronto', save: 'Salvar', cancel: 'Cancelar', ok: 'OK', done: 'Concluído', back: 'Voltar', next: 'Próximo' }, terms: { title: 'Termos e condições' }, privacy: { title: 'Política de privacidade' },
  activation: { choosePlan: 'Escolha seu plano', bestValue: 'Melhor valor ⭐', haveKey: 'Já tem uma chave de licença?', activated: 'Ativado! Bem-vindo ao SaloonBossX', buyNow: 'Comprar agora' } } };
const fr = { translation: { app: { name: 'SaloonBossX', tagline: 'Gérez • Développez • Brillez' }, nav: { home: 'Accueil', book: 'Réserver', bill: 'Facture', clients: 'Clients', more: 'Plus' },
  common: { success: 'Succès', save: 'Enregistrer', cancel: 'Annuler', ok: 'OK', done: 'Terminé', back: 'Retour', next: 'Suivant' }, terms: { title: 'Conditions générales' }, privacy: { title: 'Politique de confidentialité' },
  activation: { choosePlan: 'Choisissez votre forfait', bestValue: 'Meilleur choix ⭐', haveKey: 'Vous avez déjà une clé de licence ?', activated: 'Activé ! Bienvenue sur SaloonBossX', buyNow: 'Acheter' } } };

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
];
i18n.use(initReactI18next).init({ resources: { en, es, pt, fr, hi, ta, te, mr, bn, gu, kn }, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false }, compatibilityJSON: 'v4' });
export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => React.createElement(I18nextProvider, { i18n }, children);
export const changeLanguage = (code: string) => i18n.changeLanguage(code);

/** Active language code. Used by the type system to pick a script-safe font. */
export const getLanguage = (): string => (i18n.language || 'en').split('-')[0];

/** Languages whose script Inter cannot render. Kept beside LANGUAGES so the
 *  two lists cannot drift apart. */
export const NON_LATIN = new Set(['hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn']);
export default i18n;

/** Re-renders the calling component whenever the language changes. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (cb) => { i18n.on('languageChanged', cb); return () => { i18n.off('languageChanged', cb); }; },
    getLanguage,
    getLanguage,
  );
}
