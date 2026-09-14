import React, { useState, useEffect } from 'react';
import { getTargetedPushPrediction } from '../lib/sportsIntentTracker';
import { FavoritePredictionItem } from './FavoritesDrawer';
import { formatClubName } from './GoalCard';

interface SportsPushAlertProps {
  predictions: any[];
  onAddFavorite?: (item: FavoritePredictionItem) => void;
  isFavorite?: (fixtureId: string, market: string, pick: string) => boolean;
  triggerKey?: string;
}

export const SportsPushAlert: React.FC<SportsPushAlertProps> = ({
  predictions,
  onAddFavorite,
  isFavorite,
  triggerKey,
}) => {
  const [targetedData, setTargetedData] = useState<{ matchedPrediction: any; reason: string } | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [pushStatus, setPushStatus] = useState<'default' | 'granted' | 'denied'>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushStatus(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (!isDismissed && predictions.length > 0) {
      const match = getTargetedPushPrediction(predictions);
      setTargetedData(match);
    }
  }, [predictions, isDismissed, triggerKey]);

  const requestPushPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setPushStatus(permission);
        if (permission === 'granted' && targetedData) {
          const p = targetedData.matchedPrediction;
          const home = formatClubName(p.fixture?.home_team?.short_name || p.fixture?.home_team?.name || 'Home');
          const away = formatClubName(p.fixture?.away_team?.short_name || p.fixture?.away_team?.name || 'Away');
          new Notification(`Oddsbanta Signal: ${home} vs ${away}`, {
            body: `🔥 High Edge Detected: ${p.market === 'over_2.5_goals' ? 'Over 2.5 Goals' : '1H Over 0.5'} (${Math.round((p.probability || 0.75) * 100)}% Confidence)`,
            icon: '/oddsbanta-logo.svg',
          });
        }
      } catch (err) {
        console.warn('Push notification request error:', err);
      }
    }
  };

  if (isDismissed || !targetedData) return null;

  const pred = targetedData.matchedPrediction;
  const homeName = formatClubName(pred.fixture?.home_team?.short_name || pred.fixture?.home_team?.name || pred.metadata?.home_team || 'Home');
  const awayName = formatClubName(pred.fixture?.away_team?.short_name || pred.fixture?.away_team?.name || pred.metadata?.away_team || 'Away');
  const prob = Math.round((pred.probability || 0.75) * 100);
  const marketLabel = pred.market === 'over_2.5_goals' ? 'Over 2.5 Goals' : '1st Half Over 0.5';

  const isFav = isFavorite ? isFavorite(pred.fixture_id, pred.market, pred.predicted_outcome) : false;

  const handleAdd = () => {
    if (!onAddFavorite) return;
    onAddFavorite({
      id: `${pred.fixture_id}::${pred.market}::${pred.predicted_outcome}`,
      fixtureId: pred.fixture_id,
      homeTeam: homeName,
      awayTeam: awayName,
      league: pred.fixture?.league?.name || pred.metadata?.league || 'League',
      targetKickoffAt: pred.target_kickoff_at || pred.fixture?.target_kickoff_at || new Date().toISOString(),
      market: marketLabel,
      prediction: marketLabel,
      probability: prob,
      confidenceCategory: 'TARGETED PUSH SIGNAL',
    });
  };

  return (
    <div className="sports-targeted-push-alert" role="alert">
      <div className="push-alert-left">
        <span className="push-pulse-icon">⚡</span>
        <div className="push-alert-text">
          <div className="push-alert-header-line">
            <span className="push-tag">TARGETED MATCH SIGNAL</span>
            <span className="push-reason">{targetedData.reason}</span>
          </div>
          <p className="push-match-body">
            <strong>{homeName} vs {awayName}</strong> — AI calibrated <strong>{marketLabel}</strong> at{' '}
            <span className="push-prob-highlight">{prob}% Confidence</span>
          </p>
        </div>
      </div>

      <div className="push-alert-right">
        {pushStatus !== 'granted' && (
          <button
            type="button"
            className="push-bell-optin-btn"
            onClick={requestPushPermission}
            title="Enable browser alerts for your favorite teams"
          >
            🔔 Enable Push
          </button>
        )}

        <button
          type="button"
          className={`push-add-slip-btn ${isFav ? 'starred' : ''}`}
          onClick={handleAdd}
        >
          {isFav ? '✓ In Acca Slip' : '+ Add to Slip'}
        </button>

        <button
          type="button"
          className="push-dismiss-btn"
          onClick={() => setIsDismissed(true)}
          title="Dismiss recommendation"
          aria-label="Dismiss alert"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
