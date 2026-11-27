import React, { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Globe, Settings, Users } from 'lucide-react';
import wordmarkDark from './assets/faktum-wordmark-dark.png';
import wordmarkLight from './assets/faktum-wordmark-light.png';
import type {
  AppSettings,
  CapturedBatchEvent,
  CapturedKeyEntry,
  DownloadFormats,
  DownloadProgressEvent,
  ParsedComprobante,
  PortalStatusEvent,
  RangeProgressEvent,
  RucProfile,
} from '../../shared/types';
import { CaptureSelectorModal } from './components/CaptureSelectorModal';
import { HistoryTable } from './components/HistoryTable';
import { PortalWorkspace } from './components/PortalWorkspace';
import { ProfileModal } from './components/ProfileModal';
import { ProfilesView } from './components/ProfilesView';
import { SettingsView } from './components/SettingsView';

type NavTab = 'portal' | 'history' | 'profiles' | 'settings';

export const App: React.FC = () => {
  const [tab, setTab] = useState<NavTab>('portal');
  const [profiles, setProfiles] = useState<RucProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [comprobantes, setComprobantes] = useState<ParsedComprobante[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    outputDir: '',
    concurrency: 10,
    autoExportExcel: true,
    defaultDownloadXml: true,
    defaultDownloadPdf: true,
    autoTriggerReportAfterSearch: true,
  });
  const [encryptionAvailable, setEncryptionAvailable] = useState(false);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<RucProfile | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [capturedBatch, setCapturedBatch] = useState<CapturedBatchEvent | null>(null);
  const [selectorModalOpen, setSelectorModalOpen] = useState(false);

  const [portalStatus, setPortalStatus] = useState<PortalStatusEvent>({
    state: 'idle',
    url: '',
    message: '',
  });
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressEvent | null>(null);
  const [rangeProgress, setRangeProgress] = useState<RangeProgressEvent | null>(null);

  const loadAll = useCallback(async () => {
    const [pList, sObj, cList, encOk] = await Promise.all([
      window.faktum.listProfiles(),
      window.faktum.getSettings(),
      window.faktum.listComprobantes(),
      window.faktum.isEncryptionAvailable(),
    ]);
    setProfiles(pList);
    setSettings(sObj);
    setComprobantes(cList);
    setEncryptionAvailable(encOk);
    setSelectedProfileId((prev) => (prev && pList.some((p) => p.id === prev) ? prev : ''));
  }, []);

  const refreshHistory = useCallback(async () => {
    const [cList, pList] = await Promise.all([
      window.faktum.listComprobantes(),
      window.faktum.listProfiles(),
    ]);
    setComprobantes(cList);
    setProfiles(pList);
  }, []);

  useEffect(() => {
    void loadAll();
    const unsubPortal = window.faktum.onPortalStatus((ev) => setPortalStatus(ev));
    const unsubCaptured = window.faktum.onCapturedBatch((batch) => {
      setCapturedBatch(batch);
      setSelectorModalOpen(true);
    });
    const unsubDownload = window.faktum.onDownloadProgress((ev) => {
      setDownloadProgress(ev);
      if (ev.status === 'completed' || ev.status === 'cancelled') {
        void refreshHistory().then(async () => {
          const latest = await window.faktum.listComprobantes();
          const downloadedSet = new Set(latest.map((c) => c.claveAcceso));
          setCapturedBatch((prev) =>
            prev
              ? {
                  ...prev,
                  entries: prev.entries.map((entry) => ({
                    ...entry,
                    alreadyDownloaded: downloadedSet.has(entry.claveAcceso),
                  })),
                }
              : prev
          );
        });
      }
    });
    const unsubRange = window.faktum.onRangeProgress((ev) => {
      setRangeProgress(ev);
      if (ev.status === 'completed' || ev.status === 'cancelled') {
        void refreshHistory();
      }
    });
    return () => {
      unsubPortal();
      unsubCaptured();
      unsubDownload();
      unsubRange();
    };
  }, [loadAll, refreshHistory]);

  const anyModalOpen = profileModalOpen || confirmModalOpen || selectorModalOpen;

  // Clear stale completed download/range banners and captured list when switching to another RUC
  useEffect(() => {
    setDownloadProgress((prev) => (prev && prev.status === 'running' ? prev : null));
    setRangeProgress((prev) => (prev && prev.active ? prev : null));
    setCapturedBatch((prev) => (prev && prev.profileId === selectedProfileId ? prev : null));
  }, [selectedProfileId]);

  const activeComprobantes = selectedProfileId
    ? comprobantes.filter((c) => c.profileId === selectedProfileId)
    : [];
  const activeProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;

  const handleConfirmSelectedDownload = async (entries: CapturedKeyEntry[], formats: DownloadFormats) => {
    if (!capturedBatch) return;
    await window.faktum.startSelectedDownload({
      profileId: capturedBatch.profileId,
      entries,
      periodYear: capturedBatch.periodYear,
      periodMonth: capturedBatch.periodMonth,
      formats,
    });
  };

  const handleOpenNewProfile = () => {
    setEditingProfile(null);
    setProfileModalOpen(true);
  };

  const handleEditProfile = (profile: RucProfile) => {
    setEditingProfile(profile);
    setProfileModalOpen(true);
  };

  const handleProfileSaved = (saved: RucProfile) => {
    void loadAll().then(() => {
      setSelectedProfileId(saved.id);
    });
  };

  const handleUseInPortal = (profile: RucProfile) => {
    setSelectedProfileId(profile.id);
    setTab('portal');
  };

  const handleUpdateSettings = async (partial: Partial<AppSettings>) => {
    const updated = await window.faktum.updateSettings(partial);
    setSettings(updated);
  };

  const handleChooseDir = async () => {
    const chosen = await window.faktum.chooseOutputDir();
    if (chosen) {
      setSettings((prev) => ({ ...prev, outputDir: chosen }));
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand-header">
          <picture className="brand-picture">
            <source media="(prefers-color-scheme: dark)" srcSet={wordmarkDark} />
            <img src={wordmarkLight} alt="Faktum" className="brand-wordmark" />
          </picture>
        </div>

        <nav className="nav-list">
          <button
            type="button"
            className="nav-btn"
            aria-current={tab === 'portal' ? 'page' : undefined}
            onClick={() => setTab('portal')}
          >
            <Globe size={17} aria-hidden="true" />
            Portal SRI
          </button>
          <button
            type="button"
            className="nav-btn"
            aria-current={tab === 'history' ? 'page' : undefined}
            onClick={() => setTab('history')}
          >
            <FileSpreadsheet size={17} aria-hidden="true" />
            {selectedProfileId ? `Comprobantes (${activeComprobantes.length})` : 'Comprobantes'}
          </button>
          <button
            type="button"
            className="nav-btn"
            aria-current={tab === 'profiles' ? 'page' : undefined}
            onClick={() => setTab('profiles')}
          >
            <Users size={17} aria-hidden="true" />
            Perfiles RUC ({profiles.length})
          </button>
          <button
            type="button"
            className="nav-btn"
            aria-current={tab === 'settings' ? 'page' : undefined}
            onClick={() => setTab('settings')}
          >
            <Settings size={17} aria-hidden="true" />
            Configuración
          </button>
        </nav>

        <div className="sidebar-footer">
          <strong>{activeProfile ? activeProfile.alias : 'Sin cuenta activa'}</strong>
          {activeProfile ? (
            <>
              <span className="mono">{activeProfile.ruc}</span>
              <span>{activeComprobantes.length} comprobantes</span>
            </>
          ) : (
            <span>Selecciona un RUC para trabajar</span>
          )}
        </div>
      </aside>

      <main className="main-area">
        {/* Keep PortalWorkspace mounted so the SRI session stays alive when switching tabs */}
        <div style={{ display: tab === 'portal' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <PortalWorkspace
            isActive={tab === 'portal'}
            anyModalOpen={anyModalOpen}
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            onSelectProfile={setSelectedProfileId}
            onOpenNewProfile={handleOpenNewProfile}
            portalStatus={portalStatus}
            downloadProgress={downloadProgress}
            onClearDownloadProgress={() => setDownloadProgress(null)}
            rangeProgress={rangeProgress}
            onClearRangeProgress={() => setRangeProgress(null)}
            defaultFormats={{
              xml: settings.defaultDownloadXml,
              pdf: settings.defaultDownloadPdf,
              excel: settings.autoExportExcel,
            }}
            capturedCount={
              capturedBatch && capturedBatch.profileId === selectedProfileId
                ? capturedBatch.entries.length
                : 0
            }
            comprobantesCount={activeComprobantes.length}
            outputDir={settings.outputDir}
            onOpenCapturedSelector={() => setSelectorModalOpen(true)}
            onOpenHistory={() => setTab('history')}
          />
        </div>

        {tab === 'history' && (
          <HistoryTable
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            onSelectProfile={setSelectedProfileId}
            comprobantes={comprobantes}
            outputDir={settings.outputDir}
            onRefresh={() => void refreshHistory()}
          />
        )}

        {tab === 'profiles' && (
          <ProfilesView
            profiles={profiles}
            encryptionAvailable={encryptionAvailable}
            onAdd={handleOpenNewProfile}
            onEdit={handleEditProfile}
            onUseInPortal={handleUseInPortal}
            onDeleted={() => void loadAll()}
            onConfirmModalChange={setConfirmModalOpen}
          />
        )}

        {tab === 'settings' && (
          <SettingsView
            settings={settings}
            encryptionAvailable={encryptionAvailable}
            onChange={handleUpdateSettings}
            onChooseDir={handleChooseDir}
          />
        )}
      </main>

      <ProfileModal
        open={profileModalOpen}
        editing={editingProfile}
        encryptionAvailable={encryptionAvailable}
        onClose={() => setProfileModalOpen(false)}
        onSaved={handleProfileSaved}
      />

      <CaptureSelectorModal
        open={selectorModalOpen}
        batch={capturedBatch}
        defaultFormats={{
          xml: settings.defaultDownloadXml,
          pdf: settings.defaultDownloadPdf,
          excel: settings.autoExportExcel,
        }}
        onClose={() => setSelectorModalOpen(false)}
        onConfirmDownload={handleConfirmSelectedDownload}
      />
    </div>
  );
};
