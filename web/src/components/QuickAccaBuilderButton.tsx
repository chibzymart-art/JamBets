import React from 'react';
import { UnifiedMarketPrediction } from '../lib/marketFeedService';
import { FavoritePredictionItem } from './FavoritesDrawer';
import { formatClubName } from './GoalCard';

export interface QuickAccaBuilderButtonProps {
  predictions: UnifiedMarketPrediction[];
  onAddBatch: (items: FavoritePredictionItem[]) => void;
  onOpenSlip: () => void;
  activeMarketLabel: string;
}

export const QuickAccaBuilderButton: React.FC<QuickAccaBuilderButtonProps> = ({
  predictions,
  onAddBatch,
  onOpenSlip,
  activeMarketLabel,
}) => {
  // Find top 3 unlocked picks
  const unlocked = predictions.filter((p) => !p.is_locked && p.probability && p.probability > 0);

  if (unlocked.length < 2) return null;

  const handleBuildAcca = () => {
    // Sort by display probability descending
    const sorted = [...unlocked].sort(
      (a, b) => (b.display_probability || 0) - (a.display_probability || 0)
    );
    const topThree = sorted.slice(0, 3);

    const items: FavoritePredictionItem[] = topThree.map((pred) => {
      const homeName = formatClubName(pred.fixture?.home_team?.short_name || pred.fixture?.home_team?.name || 'Home Club');
      const awayName = formatClubName(pred.fixture?.away_team?.short_name || pred.fixture?.away_team?.name || 'Away Club');
      const leagueName = pred.fixture?.league?.name || pred.fixture?.league?.code || 'Football';

      return {
        id: `${pred.fixture_id}::${pred.market}::${pred.prediction}`,
        fixtureId: pred.fixture_id,
        homeTeam: homeName,
        awayTeam: awayName,
        league: leagueName,
        targetKickoffAt: pred.target_kickoff_at || pred.fixture?.target_kickoff_at || new Date().toISOString(),
        market: pred.market_label,
        prediction: pred.prediction,
        probability: pred.probability || 0.75,
        confidenceCategory: pred.confidence_category,
      };
    });

    onAddBatch(items);
    onOpenSlip();
  };

  return (
    <button
      type="button"
      className="quick-acca-builder-btn"
      onClick={handleBuildAcca}
      title={`Automatically build a 3-Fold Acca from top ${activeMarketLabel} signals`}
    >
      <span className="acca-btn-flash">⚡</span>
      <span className="acca-btn-title">1-Click 3-Fold Acca</span>
      <span className="acca-btn-sub">Top Signals → Acca Slip</span>
    </button>
  );
};
