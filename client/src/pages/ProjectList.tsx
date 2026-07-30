import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Typography, Tag, Space, Empty, Spin, Popconfirm, message } from 'antd';
import { PlusOutlined, FileTextOutlined, DeleteOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { listProjects, deleteProject } from '../services/project';
import type { Project } from '@exam-maker/shared';

const { Title, Text } = Typography;

const statusMap: Record<string, { color: string; label: string }> = {
  drafting: { color: 'default', label: '草稿' },
  parsing: { color: 'processing', label: '解析中' },
  blueprinting: { color: 'warning', label: '待确认细目表' },
  templating: { color: 'warning', label: '待确认模板' },
  generating: { color: 'processing', label: '生成中' },
  compiling: { color: 'processing', label: '编译中' },
  done: { color: 'success', label: '已完成' },
  error: { color: 'error', label: '出错' },
};

const ProjectList: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const data = await listProjects();
      setProjects(data);
    } catch {
      message.error('加载项目列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await deleteProject(id);
      message.success('项目已删除');
      loadProjects();
    } catch {
      message.error('删除失败');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>我的出卷项目</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/projects/new')}>
          新建项目
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <Empty description="还没有出卷项目">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/projects/new')}>
              创建第一个项目
            </Button>
          </Empty>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {projects.map((p) => {
            const status = statusMap[p.status] || statusMap.drafting;
            return (
              <Card
                key={p.id}
                hoverable
                onClick={() => navigate(`/projects/${p.id}`)}
                actions={[
                  <Popconfirm
                    key="delete"
                    title="确定删除此项目？"
                    onConfirm={(e) => { handleDelete(p.id, e); }}
                    onCancel={(e) => { e?.stopPropagation(); }}
                  >
                    <DeleteOutlined onClick={(e) => { e.stopPropagation(); }} />
                  </Popconfirm>,
                  <ArrowRightOutlined key="enter" />,
                ]}
              >
                <Card.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 28, color: '#1677ff' }} />}
                  title={p.title}
                  description={
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">📖 {p.course}</Text>
                      </div>
                      <div>
                        <Text type="secondary">
                          🎯 {p.difficulty.basic}/{p.difficulty.medium}/{p.difficulty.hard} · {p.nSets}套 · {p.outputType}
                        </Text>
                      </div>
                      <Tag color={status.color}>{status.label}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(p.createdAt).toLocaleDateString('zh-CN')}
                      </Text>
                    </Space>
                  }
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProjectList;
