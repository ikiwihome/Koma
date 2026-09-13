/**
 * 资产匹配确认组件
 * 在分析时展示新资产与已有资产的匹配情况，让用户确认
 */
import React, { useState, useCallback } from 'react';
import {
  Modal,
  Flex,
  Radio,
  Button,
  Tag,
  Space,
  Typography,
  Divider,
} from 'antd';
import { PlusOutlined, LinkOutlined } from '@ant-design/icons';
import type { Character, Scene, Prop } from '../../types';
import type { MatchResult, AssetCandidate } from '../../services/AssetMatcher';
import styles from './AssetMatchConfirm.module.scss';

const { Text, Paragraph } = Typography;

interface AssetMatchConfirmProps {
  visible: boolean;
  matches: MatchResult[];
  existingAssets: {
    characters: Character[];
    scenes: Scene[];
    props: Prop[];
  };
  onConfirm: (decisions: AssetMatchDecision[]) => void;
  onCancel: () => void;
}

export interface AssetMatchDecision {
  candidate: AssetCandidate;
  action: 'create' | 'link';
  linkedAssetId?: string;
}

export const AssetMatchConfirm: React.FC<AssetMatchConfirmProps> = ({
  visible,
  matches,
  existingAssets,
  onConfirm,
  onCancel,
}) => {
  const [decisions, setDecisions] = useState<Record<string, AssetMatchDecision>>({});

  // 初始化决策（高置信度自动选择链接，低置信度选择新建）
  React.useEffect(() => {
    const initial: Record<string, AssetMatchDecision> = {};
    matches.forEach((match, idx) => {
      const key = `${idx}-${match.candidate.name}`;
      if (match.type === 'existing' && match.confidence >= 0.9) {
        initial[key] = {
          candidate: match.candidate,
          action: 'link',
          linkedAssetId: match.assetId,
        };
      } else {
        initial[key] = {
          candidate: match.candidate,
          action: 'create',
        };
      }
    });
    setDecisions(initial);
  }, [matches]);

  // 切换决策
  const handleDecisionChange = useCallback((key: string, action: 'create' | 'link', linkedAssetId?: string, candidate?: AssetCandidate) => {
    setDecisions(prev => ({
      ...prev,
      [key]: {
        candidate: candidate || prev[key]?.candidate,
        action,
        linkedAssetId: action === 'link' ? linkedAssetId : undefined,
      },
    }));
  }, []);

  // 确认
  const handleConfirm = useCallback(() => {
    const finalDecisions = Object.values(decisions);
    onConfirm(finalDecisions);
  }, [decisions, onConfirm]);

  // 获取可能匹配的已有资产
  const getPotentialMatches = (_candidate: AssetCandidate): { id: string; name: string; type: string }[] => {
    const results: { id: string; name: string; type: string }[] = [];

    existingAssets.characters.forEach(c => {
      results.push({ id: c.id, name: c.name, type: '角色' });
    });
    existingAssets.scenes.forEach(s => {
      results.push({ id: s.id, name: s.name, type: '场景' });
    });
    existingAssets.props.forEach(p => {
      results.push({ id: p.id, name: p.name, type: '道具' });
    });

    return results;
  };

  // 统计
  const stats = {
    total: matches.length,
    linked: Object.values(decisions).filter(d => d.action === 'link').length,
    created: Object.values(decisions).filter(d => d.action === 'create').length,
  };

  return (
    <Modal
      title="资产匹配确认"
      open={visible}
      onCancel={onCancel}
      width={720}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="confirm" type="primary" onClick={handleConfirm}>
          确认决策
        </Button>,
      ]}
    >
      {/* 统计信息 */}
      <div className={styles.stats}>
        <Space split={<Divider type="vertical" />}>
          <Text>共 {stats.total} 个资产</Text>
          <Text className={styles.reuseText}>
            <LinkOutlined /> 复用 {stats.linked} 个
          </Text>
          <Text className={styles.createText}>
            <PlusOutlined /> 新建 {stats.created} 个
          </Text>
        </Space>
      </div>

      {/* 匹配列表 */}
      <Flex vertical className={styles.matchList}>
        {matches.map((match, idx) => {
          const key = `${idx}-${match.candidate.name}`;
          const decision = decisions[key];
          const potentialMatches = getPotentialMatches(match.candidate);

          return (
            <div key={key} className={styles.matchItem}>
              <div className={styles.matchHeader}>
                <Space>
                  <Text strong>{match.candidate.name}</Text>
                  {match.candidate.type && (
                    <Tag>{match.candidate.type}</Tag>
                  )}
                </Space>
                {match.type === 'existing' && (
                  <Tag className={match.confidence >= 0.9 ? styles.confidenceHigh : styles.confidenceMedium}>
                    置信度 {Math.round(match.confidence * 100)}%
                  </Tag>
                )}
              </div>

              {match.candidate.description && (
                <Paragraph
                  ellipsis={{ rows: 1 }}
                  type="secondary"
                  className={styles.candidateDescription}
                >
                  {match.candidate.description}
                </Paragraph>
              )}

              <Radio.Group
                value={decision?.action}
                onChange={(e) => {
                  if (e.target.value === 'create') {
                    handleDecisionChange(key, 'create', undefined, match.candidate);
                  }
                }}
                size="small"
              >
                <Radio value="create">
                  <PlusOutlined /> 新建资产
                </Radio>
                {match.type === 'existing' && match.assetId && (
                  <Radio
                    value="link"
                    onClick={() => handleDecisionChange(key, 'link', match.assetId, match.candidate)}
                  >
                    <LinkOutlined /> 链接到「{match.reason}」
                  </Radio>
                )}
              </Radio.Group>

              {/* 如果原本判断为新建，但用户可能想手动链接到其他资产 */}
              {match.type === 'new' && potentialMatches.length > 0 && (
                <div className={styles.manualLinkBlock}>
                  <Text type="secondary" className={styles.manualLinkLabel}>
                    或手动链接到：
                  </Text>
                  <div className={styles.manualLinkTags}>
                    {potentialMatches.slice(0, 5).map(pm => (
                      <Tag
                        key={pm.id}
                        className={`${styles.clickableTag} ${decision?.linkedAssetId === pm.id ? styles.linkedTag : ''}`}
                        onClick={() => handleDecisionChange(key, 'link', pm.id, match.candidate)}
                      >
                        {pm.name}
                      </Tag>
                    ))}
                    {potentialMatches.length > 5 && (
                      <Tag>+{potentialMatches.length - 5} 更多</Tag>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Flex>
    </Modal>
  );
};

export default AssetMatchConfirm;
