import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const COLLAPSE_KEY = 'ordersReportSidebarCollapsed';

/**
 * Sidebar de navegación (sustituye al selector de vista + tabs de compañía).
 * Sigue los lineamientos del organismo SideMenu del design system GLUE UI:
 * https://symmetrical-bassoon-g3k1nnl.pages.github.io/?path=/docs/organisms-sidemenu--documentation
 */
function Sidebar({ items, view, onSelectView, company, onSelectCompany }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* localStorage no disponible (modo privado, etc.) */
    }
  }, [collapsed]);

  return (
    <nav className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} aria-label="Menú principal">
      <ul className="sidebar__list" role="tablist" aria-label="Vista">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.key;
          const showSubmenu = isActive && item.submenu && !collapsed;

          return (
            <li key={item.key} className="sidebar__item-wrap">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                title={collapsed ? item.label : undefined}
                className={`sidebar__item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectView(item.key)}
              >
                <Icon size={20} strokeWidth={2} className="sidebar__icon" />
                <span className="sidebar__label">{item.label}</span>
              </button>

              {showSubmenu && (
                <ul className="sidebar__submenu" role="tablist" aria-label="Compañía">
                  {item.submenu.map((sub) => {
                    // Items como "Boutiques" representan varias compañías a la vez
                    // (el filtro real vive dentro del dashboard, no en el sidebar).
                    const isActiveSub = sub.matchKeys
                      ? sub.matchKeys.includes(company)
                      : company === sub.key;

                    return (
                      <li key={sub.key}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isActiveSub}
                          className={`sidebar__subitem ${isActiveSub ? 'active' : ''}`}
                          onClick={() => {
                            if (sub.matchKeys) {
                              onSelectCompany(isActiveSub ? company : sub.matchKeys[0]);
                            } else {
                              onSelectCompany(sub.key);
                            }
                          }}
                        >
                          <span className="sidebar__dot" aria-hidden="true" />
                          {sub.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="sidebar__toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </nav>
  );
}

export default Sidebar;
