import React, { useMemo, useState, useEffect } from 'react';
import { Avatar, Tooltip, Popover, Input, Button, message, Divider, Tag, Typography } from 'antd';
import { UserOutlined, CheckCircleFilled, CloseCircleFilled, KeyOutlined, ReloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { LayoutGrid, Settings, Puzzle, MessageCircle, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Project, Episode } from '../../types';
import { usePluginStore } from '../../store/pluginStore';
import { activationService, ActivationInfo, TokenUsageInfo } from '../../services/agnesActivationService';
import { electronService } from '../../services/electronService';
import { useTaskPanelStore } from '../../store/taskPanelStore';
import { AppLogo } from './AppLogo';
import styles from './Sidebar.module.scss';

const { Text } = Typography;

// 视图类型：支持插件路由
export type AppView = 'projects' | 'overview' | 'editor' | 'settings' | 'plugins' | 'chat' | `plugin:${string}`;

interface SidebarProps {
  view: AppView;
  activeProject: Project | null;
  activeEpisode: Episode | null;
  onViewChange: (view: AppView) => void;
  onConfigChange?: () => void;
  activationInfo?: ActivationInfo | null;
  activationLocked?: boolean;
  onActivationChange?: (info: ActivationInfo | null) => void;
}

// 导航项组件
interface NavItemProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ active, icon, label, onClick }) => (
  <Tooltip title={label} placement="right">
    <button
      onClick={onClick}
      className={[styles.navItem, active ? styles.navItemActive : ''].filter(Boolean).join(' ')}
    >
      {active && (
        <div className={styles.activeIndicator} />
      )}
      <div className={[styles.navIconShell, active ? styles.navIconShellActive : ''].filter(Boolean).join(' ')}>
        {icon}
      </div>
    </button>
  </Tooltip>
);

export const Sidebar: React.FC<SidebarProps> = ({
  view,
  activeProject: _activeProject,
  activeEpisode: _activeEpisode,
  onViewChange,
  onConfigChange: _onConfigChange,
  activationInfo,
  activationLocked,
  onActivationChange,
}) => {
  const { t } = useTranslation();
  const plugins = usePluginStore(state => state.plugins);

  // 左下角头像 Popover 开关状态
  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false);

  // 激活状态
  const [activation, setActivation] = useState<ActivationInfo | null>(activationInfo || null);
  const [inputKey, setInputKey] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // 同步外部 activationInfo 到内部 state
  useEffect(() => {
    if (activationInfo !== undefined) {
      setActivation(activationInfo);
    }
  }, [activationInfo]);

  // 余额信息
  const [balanceInfo, setBalanceInfo] = useState<TokenUsageInfo | null>(null);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [lastBalanceRefresh, setLastBalanceRefresh] = useState<number | null>(null);

  const fetchBalance = async (apiKey?: string, channelId?: string) => {
    setRefreshingBalance(true);
    let result;
    const targetChannelId = channelId || activation?.defaultChannelIds?.llm;

    if (apiKey) {
      result = await activationService.getTokenUsage(apiKey);
    } else if (targetChannelId) {
      result = await activationService.getStoredTokenUsage(targetChannelId);
    } else {
      setRefreshingBalance(false);
      return;
    }

    setRefreshingBalance(false);
    if (result.success && result.data) {
      setBalanceInfo(result.data);
      setLastBalanceRefresh(Date.now());
    } else {
      message.error(t('activation.balanceRefreshFailed'));
    }
  };

  // 初始化加载激活状态
  useEffect(() => {
    activationService.getActivationInfo().then(info => {
      setActivation(info);
      onActivationChange?.(info);
      if (info?.defaultChannelIds?.llm) {
        fetchBalance(undefined, info.defaultChannelIds.llm);
      }
    });
  }, []);

  const handleActivate = async () => {
    if (!inputKey.trim()) {
      message.warning(t('activation.emptyKey'));
      return;
    }

    setVerifying(true);
    const result = await activationService.verifyApiKey(inputKey);
    setVerifying(false);

    if (result.success) {
      const apiKey = inputKey.trim();

      // 自动创建/更新默认渠道
      const channelResult = await activationService.ensureDefaultModelChannels(apiKey);
      if (!channelResult.success) {
        message.error(t('activation.defaultChannelsFailed'));
        return;
      }

      const info: ActivationInfo = {
        activatedAt: Date.now(),
        lastValidatedAt: Date.now(),
        maskedKey: activationService.maskApiKey(apiKey),
        defaultChannelIds: channelResult.channelIds!,
      };

      await activationService.saveActivationInfo(info);
      setActivation(info);
      onActivationChange?.(info);
      _onConfigChange?.();
      setInputKey('');
      setIsEditing(false);
      message.success(t('activation.verifySuccess'));
      // 激活成功后加载余额
      fetchBalance(apiKey, channelResult.channelIds!.llm);
    } else {
      if (result.error === 'invalid_key') {
        message.error(t('activation.invalidKey'));
      } else {
        message.error(t('activation.verifyFailed'));
      }
    }
  };

  const handleDeactivate = async () => {
    await activationService.clearActivationInfo();
    setActivation(null);
    onActivationChange?.(null);
    setBalanceInfo(null);
    setLastBalanceRefresh(null);
    setInputKey('');
    setIsEditing(false);
    message.info(t('activation.deactivate'));
    _onConfigChange?.();
  };

  const handleVerify = async () => {
    if (!activation?.defaultChannelIds?.llm) return;
    setVerifying(true);
    const result = await activationService.verifyStoredActivation(activation.defaultChannelIds.llm);
    setVerifying(false);

    if (result.success) {
      const updated = { ...activation, lastValidatedAt: Date.now() };
      await activationService.saveActivationInfo(updated);
      setActivation(updated);
      onActivationChange?.(updated);
      message.success(t('activation.verifySuccess'));
      // 重新验证后顺便刷新余额
      fetchBalance(undefined, activation.defaultChannelIds.llm);
    } else {
      message.error(t('activation.verifyFailed'));
    }
  };

  const popoverContent = (
    <div className={styles.activationPopoverContent}>
      <div className={styles.activationHeader}>
        <div className={styles.activationTitleRow}>
          <Text strong className={styles.textStrong}>{t('activation.title')}</Text>
          <Button
            type="link"
            size="small"
            className={styles.activationLink}
            onClick={() => electronService.shell.openExternal('https://www.agnes-ai.cn')}
          >
            {t('activation.openKomaApi')}
          </Button>
        </div>
        {activation ? (
          <Tag color="success" icon={<CheckCircleFilled />}>{t('activation.activated')}</Tag>
        ) : (
          <Tag color="default" icon={<CloseCircleFilled />}>{t('activation.notActivated')}</Tag>
        )}
      </div>

      {!activation || isEditing ? (
        <div className="space-y-3">
          <Text type="secondary" className="block text-xs">
            {t('activation.description')}
          </Text>
          <Input.Password
            placeholder={t('activation.apiKeyPlaceholder')}
            value={inputKey}
            onChange={e => setInputKey(e.target.value)}
            onPressEnter={handleActivate}
            prefix={<KeyOutlined className={styles.textMuted} />}
            className={styles.activationInput}
          />
          <div className="flex gap-2">
            <Button
              type="primary"
              block
              loading={verifying}
              onClick={handleActivate}
              className={styles.activationPrimaryButton}
            >
              {verifying ? t('activation.activating') : t('activation.activate')}
            </Button>
            {isEditing && (
              <Button onClick={() => setIsEditing(false)}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={styles.activationCard}>
            <div className="flex justify-between items-center">
              <Text type="secondary" className="text-xs">{t('settings.apiKey')}</Text>
              <Text className={styles.activationKeyText}>
                {activation.maskedKey}
              </Text>
            </div>

            <Divider className={styles.activationDividerCompact} />

            <div className="flex justify-between items-center">
              <Text type="secondary" className="text-xs font-medium">{t('activation.balanceTitle')}</Text>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined spin={refreshingBalance} />}
                onClick={() => fetchBalance()}
                className={styles.activationIconButton}
              />
            </div>

            {balanceInfo ? (
              <div className="space-y-2">
                <div className="flex flex-col">
                  <Text type="secondary" className="text-[11px] mb-0.5">{t('activation.remainingQuota')}</Text>
                  <Text className={styles.activationQuota}>
                    {balanceInfo.unlimitedQuota ? t('activation.unlimitedQuota') : activationService.formatUsdQuota(balanceInfo.totalAvailable, balanceInfo.quotaPerUnit)}
                  </Text>
                </div>

                <div className={styles.activationQuotaGrid}>
                  <div className="flex flex-col">
                    <Text type="secondary" className="text-[10px]">{t('activation.usedQuota')}</Text>
                    <Text className={styles.activationQuotaSubtle}>
                      {activationService.formatUsdQuota(balanceInfo.totalUsed, balanceInfo.quotaPerUnit)}
                    </Text>
                  </div>
                  <div className="flex flex-col items-end">
                    <Text type="secondary" className="text-[10px]">{t('activation.totalQuota')}</Text>
                    <Text className={styles.activationQuotaMuted}>
                      {activationService.formatUsdQuota(balanceInfo.totalGranted, balanceInfo.quotaPerUnit)}
                    </Text>
                  </div>
                </div>

                {lastBalanceRefresh && (
                  <div className="pt-1 text-right">
                    <Text className={styles.activationRefreshTime}>
                      {t('activation.lastBalanceRefresh')}: {new Date(lastBalanceRefresh).toLocaleTimeString()}
                    </Text>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-2 text-center">
                <Text type="secondary" className="text-[11px] italic">
                  {refreshingBalance ? t('common.loading') : '-'}
                </Text>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={verifying}
              onClick={handleVerify}
            >
              {t('activation.verify')}
            </Button>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setInputKey('');
                setIsEditing(true);
              }}
            >
              {t('activation.changeKey')}
            </Button>
          </div>

          <Divider className={styles.activationDivider} />

          <Button
            danger
            block
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            onClick={handleDeactivate}
          >
            {t('activation.deactivate')}
          </Button>
        </div>
      )}
    </div>
  );

  const globalPlugins = useMemo(
    () => plugins.filter(p => p.category === 'global' && p.isEnabled),
    [plugins]
  );

  const taskPanelOpen = useTaskPanelStore(s => s.open);
  const toggleTaskPanel = useTaskPanelStore(s => s.toggle);

  const mainNavItems = [
    { key: 'projects', icon: <LayoutGrid size={22} />, label: t('sidebar.projects') },
    { key: 'chat', icon: <MessageCircle size={22} />, label: t('chat.title') },
  ];

  const pluginNavItems = globalPlugins
    .sort((a, b) => (a.globalMeta?.navigation?.order || 50) - (b.globalMeta?.navigation?.order || 50))
    .map(plugin => ({
      key: `plugin:${plugin.id}`,
      icon: <Puzzle size={22} />,
      label: plugin.globalMeta?.navigation?.label || plugin.name,
    }));

  const bottomNavItems = [
    { key: 'settings', icon: <Settings size={22} />, label: t('sidebar.settings') },
  ];

  const handleNavClick = (key: string) => {
    if (activationLocked) {
      message.warning(t('activation.activationRequired'));
      setAvatarPopoverOpen(true);
      return;
    }
    onViewChange(key as AppView);
  };

  return (
    <div className={styles.sidebar}>
      {/* Logo 区域 */}
      <div className="h-14 w-full flex items-center justify-center">
        <AppLogo variant="sidebar" />
      </div>

      {/* 主导航区 */}
      <nav className="flex-1 flex flex-col py-2">
        <div className="space-y-1">
          {mainNavItems.map(item => (
            <NavItem
              key={item.key}
              active={view === item.key}
              icon={item.icon}
              label={item.label}
              onClick={() => handleNavClick(item.key)}
            />
          ))}
          {/* 任务面板入口：点击仅 toggle Drawer，不切 view */}
          <NavItem
            active={taskPanelOpen}
            icon={<ListChecks size={22} />}
            label={t('task.title')}
            onClick={toggleTaskPanel}
          />
        </div>

        {pluginNavItems.length > 0 && (
          <>
            <div className="mx-4 my-3 border-t border-border-subtle" />
            <div className="space-y-1">
              {pluginNavItems.map(item => (
                <NavItem
                  key={item.key}
                  active={view === item.key}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => handleNavClick(item.key)}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex-1" />
        <div className="mx-4 my-3 border-t border-border-subtle" />

        <div className="space-y-1">
          {bottomNavItems.map(item => (
            <NavItem
              key={item.key}
              active={view === item.key}
              icon={item.icon}
              label={item.label}
              onClick={() => handleNavClick(item.key)}
            />
          ))}
        </div>
      </nav>

      {/* 底部头像入口 */}
      <div className="p-3 border-t border-border-subtle flex items-center justify-center">
        <Popover
          open={avatarPopoverOpen}
          onOpenChange={setAvatarPopoverOpen}
          trigger="click"
          placement="rightBottom"
          content={popoverContent}
          overlayClassName="activation-popover"
        >
          <Avatar
            size={36}
            className={activation ? styles.avatarActive : styles.avatarInactive}
            icon={<UserOutlined />}
          />
        </Popover>
      </div>
    </div>
  );
};
