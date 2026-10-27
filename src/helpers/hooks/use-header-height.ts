import { useHeaderHeight as useHeaderHeightElements } from '@react-navigation/elements';

/**
 * Returns the current height of the screen's header, status bar included, so content placed under
 * a transparent header starts right below it. It follows every change: the first value React
 * Navigation reports on Android can be short of the settled height (86 pt against 94 pt on the
 * tablet), and keeping it left content under the header's last points.
 */
function useHeaderHeight(): number {
  return useHeaderHeightElements();
}
export default useHeaderHeight;
