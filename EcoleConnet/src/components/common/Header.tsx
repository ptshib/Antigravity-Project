import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Bell, MessageSquare, Phone, Menu } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenMobileMenu?: () => void;
  onOpenMessaging?: () => void;
  onOpenSelector?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onOpenMobileMenu,
  onOpenMessaging
}) => {
  const { user, role } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [showNotifMenu, setShowNotifMenu] = useState(false);

  const whatsappUrl = `https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}?text=Bonjour%20PaTShi-Digital,%20je%20souhaite%20en%20savoir%20plus%20sur%20ÉcoleConnect`;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-3 sm:px-8 py-3 flex items-center justify-between shadow-xs max-w-full overflow-hidden">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 mr-2">
        {onOpenMobileMenu && (
          <button
            onClick={onOpenMobileMenu}
            className="lg:hidden p-1.5 sm:p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
            aria-label="Ouvrir le menu mobile"
          >
            <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}
        <div className="min-w-0 truncate">
          <h1 className="text-base sm:text-2xl font-extrabold text-slate-900 tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-[11px] sm:text-xs text-slate-500 font-medium truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* WhatsApp Contact button */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200/60 transition-colors shrink-0"
          title="Contacter PaTShi-Digital sur WhatsApp"
        >
          <Phone className="w-3.5 h-3.5 text-emerald-600" />
          <span>WhatsApp PaTShi</span>
        </a>

        {/* Messaging button */}
        {onOpenMessaging && (
          <button
            onClick={onOpenMessaging}
            className="p-2 sm:p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors relative cursor-pointer shrink-0"
            title="Messagerie interne"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        )}

        {/* Notifications Bell */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowNotifMenu(!showNotifMenu)}
            className="p-2 sm:p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors relative cursor-pointer shrink-0"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white font-bold text-[10px] rounded-full flex items-center justify-center animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showNotifMenu && (
            <div className="absolute right-0 mt-2 w-72 sm:w-96 max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 py-3 z-50 animate-scale-up">
              <div className="flex items-center justify-between px-4 pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-slate-900 text-sm">Notifications</h4>
                  {unreadCount > 0 && (
                    <span className="bg-blue-100 text-blue-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
                      {unreadCount} non lues
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                  >
                    Tout marquer lu
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">Aucune notification</div>
                ) : (
                  notifications.map(notif => (
                    <div
                      key={notif.id}
                      onClick={() => markAsRead(notif.id)}
                      className={`p-3.5 transition-colors cursor-pointer flex items-start gap-3 ${
                        notif.read ? 'bg-white opacity-70' : 'bg-blue-50/40'
                      }`}
                    >
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                          notif.type === 'urgent'
                            ? 'bg-rose-500'
                            : notif.type === 'warning'
                            ? 'bg-amber-500'
                            : notif.type === 'success'
                            ? 'bg-emerald-500'
                            : 'bg-blue-500'
                        }`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-900">{notif.title}</p>
                          <span className="text-[10px] text-slate-400">{notif.date}</span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1 leading-normal">{notif.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Avatar */}
        <div className="flex items-center gap-2 pl-1.5 sm:pl-2 border-l border-slate-200 shrink-0">
          <img
            src={user?.avatar}
            alt={user?.name}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border-2 border-amber-400 shadow-xs shrink-0"
          />
          <div className="hidden sm:block text-left">
            <p className="text-xs font-bold text-slate-900 leading-tight truncate max-w-[120px]">
              {user?.name}
            </p>
            <p className="text-[10px] text-slate-500 capitalize">{role}</p>
          </div>
        </div>
      </div>
    </header>
  );
};
