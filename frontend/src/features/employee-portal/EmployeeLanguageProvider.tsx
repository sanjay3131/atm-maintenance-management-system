import { useMemo, useState, type ReactNode } from "react";
import {
  EmployeeLanguageContext,
  readLanguagePreference,
  STORAGE_KEY,
  translate,
  type EmployeeTranslationKey,
  type EmployeeLanguage,
  type TranslationValues,
} from "./i18n";

export default function EmployeeLanguageProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState(readLanguagePreference);
  const setLanguage = (nextLanguage: EmployeeLanguage) => {
    setLanguageState(nextLanguage);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch {
      // Keep the selection active for this visit if storage is unavailable.
    }
  };
  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: EmployeeTranslationKey, values?: TranslationValues) =>
        translate(language, key, values),
    }),
    [language],
  );

  return (
    <EmployeeLanguageContext.Provider value={value}>
      {children}
    </EmployeeLanguageContext.Provider>
  );
}
