import { PLAY_BASE_PATH } from '../../components/HubSwitch';

export type TabId = 'today' | 'picks' | 'leaderboard' | 'leagues' | 'profile';

export const PLAY_TABS: { id: TabId; path: string; label: string; icon: string }[] = [
  { id: 'today', path: PLAY_BASE_PATH, label: 'Today', icon: '🎯' },
  { id: 'picks', path: `${PLAY_BASE_PATH}/picks`, label: 'My Picks', icon: '📝' },
  { id: 'leaderboard', path: `${PLAY_BASE_PATH}/leaderboard`, label: 'Leaderboard', icon: '🏆' },
  { id: 'leagues', path: `${PLAY_BASE_PATH}/leagues`, label: 'Leagues', icon: '👥' },
  { id: 'profile', path: `${PLAY_BASE_PATH}/profile`, label: 'Profile', icon: '👤' },
];

export const playTabFromPath = (pathname: string): TabId => {
  const p = pathname.replace(/\/+$/, '');
  const hit = PLAY_TABS.find((t) => t.path === p);
  return hit ? hit.id : 'today';
};
