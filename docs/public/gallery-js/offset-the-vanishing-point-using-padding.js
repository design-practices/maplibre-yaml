// The escape hatch: camera padding via easeTo. Padding shrinks the part
// of the canvas the camera treats as "the view", so the centre point and
// the vanishing point shift out from under an open sidebar. The sidebars
// are <ml-map> slot children; each toggle eases padding on its side to
// the sidebar's width.
const mapEl = document.querySelector("ml-map");
const SIDEBAR_WIDTH = 300; // px — matches the open sidebar's CSS width

async function toggleSidebar(side) {
  const sidebar = document.querySelector(`[data-sidebar="${side}"]`);
  const open = sidebar.classList.toggle("open");
  const map = await mapEl.mapReady();
  map.easeTo({ padding: { [side]: open ? SIDEBAR_WIDTH : 0 }, duration: 1000 });
}

for (const button of document.querySelectorAll("[data-sidebar-toggle]")) {
  button.addEventListener("click", () => toggleSidebar(button.dataset.sidebarToggle));
}

// Upstream opens the left sidebar once the map has loaded.
mapEl.mapReady().then(() => toggleSidebar("left"));
