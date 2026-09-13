/**
 * AI 分镜预选资产对话框
 * 在启动 AI 分镜生成前，让用户选择要使用的角色和道具
 */
import React, { useState, useMemo } from 'react';
import {
  Modal,
  Checkbox,
  Row,
  Col,
  Typography,
  Empty,
  Image,
  Space,
  Divider,
} from 'antd';
import {
  UserOutlined,
  InboxOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { Character, Prop } from '../../types';
import type { PresetAssets } from '../../services/ShotAnalysisService';
import { electronService } from '../../services/electronService';
import { getMediaAssetDisplaySource } from '../../types';
import styles from './ShotAssetPresetModal.module.scss';

const { Text } = Typography;

interface ShotAssetPresetModalProps {
  open: boolean;
  characters: Character[];
  props: Prop[];
  onConfirm: (assets: PresetAssets) => void;
  onCancel: () => void;
}

export const ShotAssetPresetModal: React.FC<ShotAssetPresetModalProps> = ({
  open,
  characters,
  props,
  onConfirm,
  onCancel,
}) => {
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [selectedPropIds, setSelectedPropIds] = useState<string[]>([]);

  // 只显示已绑定 Sora2 的资产
  const boundCharacters = useMemo(
    () => characters.filter(c => c.sora2CharacterId),
    [characters]
  );
  const boundProps = useMemo(
    () => props.filter(p => p.sora2PropId),
    [props]
  );

  const handleConfirm = () => {
    onConfirm({
      characterIds: selectedCharacterIds,
      propIds: selectedPropIds,
    });
    // 重置选择
    setSelectedCharacterIds([]);
    setSelectedPropIds([]);
  };

  const handleCancel = () => {
    setSelectedCharacterIds([]);
    setSelectedPropIds([]);
    onCancel();
  };

  const handleCharacterToggle = (charId: string) => {
    setSelectedCharacterIds(prev =>
      prev.includes(charId)
        ? prev.filter(id => id !== charId)
        : [...prev, charId]
    );
  };

  const handlePropToggle = (propId: string) => {
    setSelectedPropIds(prev =>
      prev.includes(propId)
        ? prev.filter(id => id !== propId)
        : [...prev, propId]
    );
  };

  const handleSelectAllCharacters = (checked: boolean) => {
    if (checked) {
      setSelectedCharacterIds(boundCharacters.map(c => c.sora2CharacterId!));
    } else {
      setSelectedCharacterIds([]);
    }
  };

  const handleSelectAllProps = (checked: boolean) => {
    if (checked) {
      setSelectedPropIds(boundProps.map(p => p.sora2PropId!));
    } else {
      setSelectedPropIds([]);
    }
  };

  const toAssetUrl = (path?: string) => {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
    return electronService.fs.toLocalUrl(path);
  };

  const renderAssetCard = (
    id: string,
    name: string,
    imagePath?: string,
    selected: boolean = false,
    onClick?: () => void
  ) => (
    <div
      key={id}
      onClick={onClick}
      className={`${styles.assetCard} ${selected ? styles.assetCardSelected : ''}`}
    >
      {/* 选中标记 */}
      {selected && (
        <CheckCircleOutlined className={styles.checkIcon} />
      )}
      {/* 图片 */}
      <div className={styles.imageFrame}>
        {imagePath ? (
          <Image
            src={toAssetUrl(imagePath)}
            alt={name}
            preview={false}
            className={styles.image}
          />
        ) : (
          <Text type="secondary" className={styles.emptyText}>无图片</Text>
        )}
      </div>
      {/* 名称 */}
      <Text
        className={`${styles.assetName} ${selected ? styles.assetNameSelected : ''}`}
        ellipsis
      >
        {name}
      </Text>
    </div>
  );

  return (
    <Modal
      title="选择 AI 分镜使用的资产"
      open={open}
      onOk={handleConfirm}
      onCancel={handleCancel}
      okText="开始生成"
      cancelText="取消"
      width={700}
      styles={{
        body: { maxHeight: '60vh', overflowY: 'auto' },
      }}
    >
      {/* 角色区域 */}
      <div className={styles.section}>
        <Space className={styles.sectionHeader}>
          <UserOutlined />
          <Text strong>角色</Text>
          {boundCharacters.length > 0 && (
            <Checkbox
              checked={selectedCharacterIds.length === boundCharacters.length}
              indeterminate={
                selectedCharacterIds.length > 0 &&
                selectedCharacterIds.length < boundCharacters.length
              }
              onChange={e => handleSelectAllCharacters(e.target.checked)}
            >
              全选
            </Checkbox>
          )}
          <Text type="secondary" className={styles.countText}>
            已选 {selectedCharacterIds.length}/{boundCharacters.length}
          </Text>
        </Space>

        {boundCharacters.length > 0 ? (
          <Row gutter={[12, 12]}>
            {boundCharacters.map(char =>
              <Col key={char.id} span={4}>
                {renderAssetCard(
                  char.sora2CharacterId!,
                  char.name,
                  getMediaAssetDisplaySource(char.media?.costumePhoto),
                  selectedCharacterIds.includes(char.sora2CharacterId!),
                  () => handleCharacterToggle(char.sora2CharacterId!)
                )}
              </Col>
            )}
          </Row>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无已绑定 Sora2 的角色"
            className={styles.empty}
          />
        )}
      </div>

      <Divider className={styles.divider} />

      {/* 道具区域 */}
      <div>
        <Space className={styles.sectionHeader}>
          <InboxOutlined />
          <Text strong>道具</Text>
          {boundProps.length > 0 && (
            <Checkbox
              checked={selectedPropIds.length === boundProps.length}
              indeterminate={
                selectedPropIds.length > 0 &&
                selectedPropIds.length < boundProps.length
              }
              onChange={e => handleSelectAllProps(e.target.checked)}
            >
              全选
            </Checkbox>
          )}
          <Text type="secondary" className={styles.countText}>
            已选 {selectedPropIds.length}/{boundProps.length}
          </Text>
        </Space>

        {boundProps.length > 0 ? (
          <Row gutter={[12, 12]}>
            {boundProps.map(prop =>
              <Col key={prop.id} span={4}>
                {renderAssetCard(
                  prop.sora2PropId!,
                  prop.name,
                  getMediaAssetDisplaySource(prop.media?.previewImage),
                  selectedPropIds.includes(prop.sora2PropId!),
                  () => handlePropToggle(prop.sora2PropId!)
                )}
              </Col>
            )}
          </Row>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无已绑定 Sora2 的道具"
            className={styles.empty}
          />
        )}
      </div>

      {/* 提示信息 */}
      <Text
        type="secondary"
        className={styles.note}
      >
        提示：选中的资产将优先出现在 AI 生成的分镜中。未绑定 Sora2 的资产不会显示在此列表。
      </Text>
    </Modal>
  );
};

export default ShotAssetPresetModal;
