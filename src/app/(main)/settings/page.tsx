'use client';

import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, Download, Upload, Trash2, Volume2 } from 'lucide-react';
import { getSettings, saveSettings, exportAllData, importAllData, wipeAllData } from '@/lib/storage';
import { clearAllFiles } from '@/lib/db';
import { getVoices, sortVoicesForPicker, isSpeechSupported } from '@/lib/speech';
import type { Settings as SettingsType } from '@/lib/types';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SAMPLE_TEXT = "Voici un aperçu de cette voix pour la lecture audio de vos livres.";

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType>({ theme: 'light', textSize: 18, highlightIntensity: 0.66, defaultSpeed: 1, voiceURI: null });
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  useEffect(() => {
    setSpeechSupported(isSpeechSupported());
    getVoices().then((v) => setVoices(sortVoicesForPicker(v)));
  }, []);

  const update = (patch: Partial<SettingsType>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const testVoice = () => {
    if (!isSpeechSupported()) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(SAMPLE_TEXT);
    utter.rate = settings.defaultSpeed;
    utter.lang = 'fr-FR';
    const voice = voices.find((v) => v.voiceURI === settings.voiceURI);
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
  };

  const handleExport = () => {
    const data = exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `readflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      importAllData(JSON.parse(text));
      window.location.reload();
    } catch {
      alert("Fichier d'import invalide.");
    }
  };

  const handleWipe = async () => {
    wipeAllData();
    await clearAllFiles();
    window.location.reload();
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 md:py-14 animate-fadeUp">
      <h1 className="font-display text-3xl mb-8">Réglages</h1>

      <Section title="Apparence">
        <Row label="Thème">
          <div className="flex gap-2">
            <ToggleBtn active={settings.theme === 'light'} onClick={() => update({ theme: 'light' })}><Sun size={15} /> Clair</ToggleBtn>
            <ToggleBtn active={settings.theme === 'dark'} onClick={() => update({ theme: 'dark' })}><Moon size={15} /> Sombre</ToggleBtn>
          </div>
        </Row>
        <Row label={`Taille du texte (${settings.textSize}px)`}>
          <input type="range" min="14" max="28" value={settings.textSize} onChange={(e) => update({ textSize: Number(e.target.value) })} className="w-40" />
        </Row>
        <Row label={`Intensité du surlignage (${Math.round(settings.highlightIntensity * 100)}%)`}>
          <input type="range" min="0.2" max="1" step="0.05" value={settings.highlightIntensity} onChange={(e) => update({ highlightIntensity: Number(e.target.value) })} className="w-40" />
        </Row>
      </Section>

      <Section title="Lecture rapide">
        <Row label="Vitesse par défaut">
          <div className="flex gap-1.5 flex-wrap justify-end">
            {SPEEDS.map((s) => <ToggleBtn key={s} active={settings.defaultSpeed === s} onClick={() => update({ defaultSpeed: s })}>{s}x</ToggleBtn>)}
          </div>
        </Row>
      </Section>

      <Section title="Audio">
        {speechSupported ? (
          <>
            <Row label="Voix de lecture">
              <div className="flex items-center gap-2">
                <select
                  value={settings.voiceURI ?? ''}
                  onChange={(e) => update({ voiceURI: e.target.value || null })}
                  className="text-sm bg-transparent border border-ink/15 dark:border-paper/15 rounded-full px-3 py-1.5 max-w-[220px]"
                >
                  <option value="">Voix par défaut du navigateur</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                  ))}
                </select>
                <button onClick={testVoice} className="btn-ghost !px-2.5" title="Tester la voix"><Volume2 size={15} /></button>
              </div>
            </Row>
            {voices.length === 0 && (
              <Row label="">
                <span className="text-xs text-ink-faint">Aucune voix détectée pour l&apos;instant — réessaie dans un instant ou vérifie les voix installées sur ton appareil.</span>
              </Row>
            )}
          </>
        ) : (
          <Row label="Lecture audio">
            <span className="text-xs text-ink-faint">Non disponible sur ce navigateur.</span>
          </Row>
        )}
      </Section>

      <Section title="Données">
        <Row label="Exporter mes données"><button onClick={handleExport} className="btn-secondary !py-2 !px-4 text-sm"><Download size={15} /> Exporter</button></Row>
        <Row label="Importer des données">
          <button onClick={() => fileRef.current?.click()} className="btn-secondary !py-2 !px-4 text-sm"><Upload size={15} /> Importer</button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleImport} />
        </Row>
        <Row label="Supprimer toutes les données">
          {!confirmWipe ? (
            <button onClick={() => setConfirmWipe(true)} className="btn-ghost !text-ember"><Trash2 size={15} /> Supprimer tout</button>
          ) : (
            <div className="flex gap-2">
              <button onClick={handleWipe} className="btn-secondary !text-ember !border-ember/30 !py-1.5 !px-3 text-sm">Confirmer</button>
              <button onClick={() => setConfirmWipe(false)} className="btn-ghost !py-1.5 !px-3 text-sm">Annuler</button>
            </div>
          )}
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <p className="label mb-3">{title}</p>
      <div className="card divide-y divide-ink/[0.06] dark:divide-paper/[0.06]">{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 flex-wrap">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}
function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${active ? 'bg-ink text-paper dark:bg-gold dark:text-nightpaper' : 'bg-ink/[0.05] dark:bg-paper/10 hover:bg-ink/[0.09]'}`}>
      {children}
    </button>
  );
}
