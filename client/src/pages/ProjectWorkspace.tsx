import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Steps, Button, Typography, Tag, Space, Spin, Alert, Descriptions,
  List, Divider, message, Empty, Collapse, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined,
  PlayCircleOutlined, DownloadOutlined, FileTextOutlined,
  ReloadOutlined, QuestionCircleOutlined,
} from '@ant-design/icons';
import { getProject, approveCheckpoint, startWorkflow } from '../services/project';
import type { ProjectDetail, JobEvent, Checkpoint } from '@exam-maker/shared';

const { Title, Text, Paragraph } = Typography;

const stepItems = [
  { title: '参数配置', description: '设定课程/难度/套数' },
  { title: '真题解析', description: '转写 LaTeX + 校对' },
  { title: '双向细目表', description: '⏸ 教师确认考点分类' },
  { title: '试卷模板', description: '⏸ 教师确认题型分值' },
  { title: '难度核算', description: '自动配比' },
  { title: '生成新卷', description: '命题 + 核验' },
  { title: '编译交付', description: '⏸ 教师选卷下载' },
];

// Map project status to current step index
function statusToStep(status: string): number {
  const map: Record<string, number> = {
    drafting: 0, parsing: 1, blueprinting: 2, templating: 3,
    generating: 5, compiling: 6, done: 6, error: -1,
  };
  return map[status] ?? 0;
}

const ProjectWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    try {
      const data = await getProject(projectId);
      setProject(data);
      setEvents(data.events || []);
    } catch {
      message.error('加载项目失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => { loadProject(); }, [loadProject]);

  // SSE stream for real-time events (token passed as query param since EventSource can't set headers)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const url = `/api/projects/${projectId}/events?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const evt = JSON.parse(event.data);
        setEvents((prev) => [...prev.slice(-200), evt]);
        if (evt.eventType === 'done' || evt.eventType === 'error') {
          loadProject();
        }
      } catch { /* ignore malformed event */ }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [projectId, loadProject]);

  const handleCheckpoint = async (step: string, action: 'approve' | 'reject') => {
    setActionLoading(step);
    try {
      await approveCheckpoint(projectId, step, action);
      message.success(action === 'approve' ? '已确认，流程继续' : '已驳回');
      loadProject();
    } catch {
      message.error('操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!project) return <Empty description="项目不存在" />;

  const currentStep = statusToStep(project.status);
  const checkpointMap = new Map<string, Checkpoint>();
  project.checkpoints?.forEach((cp) => checkpointMap.set(cp.step, cp));

  const renderCheckpointActions = (step: string, label: string) => {
    const cp = checkpointMap.get(step);
    if (!cp) return null;

    if (cp.status === 'approved') {
      return <Tag color="success" icon={<CheckCircleOutlined />}>{label}已确认</Tag>;
    }
    if (cp.status === 'rejected') {
      return <Tag color="error" icon={<CloseCircleOutlined />}>{label}已驳回</Tag>;
    }
    // Pending — show approve/reject buttons if we're at this step
    if (currentStep >= statusToStepForCheckpoint(step)) {
      return (
        <Space>
          <Button
            type="primary" size="small" icon={<CheckCircleOutlined />}
            loading={actionLoading === step}
            onClick={() => handleCheckpoint(step, 'approve')}
          >
            确认{label}
          </Button>
          <Button
            danger size="small" icon={<CloseCircleOutlined />}
            loading={actionLoading === step}
            onClick={() => handleCheckpoint(step, 'reject')}
          >
            驳回
          </Button>
        </Space>
      );
    }
    return <Tag>等待中</Tag>;
  };

  const isWaitingOnCheckpoint = (() => {
    const bp = checkpointMap.get('blueprint');
    const tp = checkpointMap.get('template');
    if (project.status === 'blueprinting' && bp?.status === 'pending') return true;
    if (project.status === 'templating' && tp?.status === 'pending') return true;
    if ((project.status === 'compiling' || project.status === 'done') &&
        checkpointMap.get('selection')?.status === 'pending') return true;
    return false;
  })();

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>{project.title}</Title>
          <Tag color="blue">{project.course}</Tag>
        </Space>
        <Space>
          {(project.status === 'drafting') && (
            <Button type="primary" icon={<PlayCircleOutlined />}
              onClick={async () => {
                try {
                  await startWorkflow(projectId);
                  message.success('工作流已启动');
                  loadProject();
                } catch { message.error('启动失败'); }
              }}
            >
              开始出卷
            </Button>
          )}
          {(project.status === 'error') && (
            <Button icon={<ReloadOutlined />} onClick={async () => {
              try {
                await startWorkflow(projectId);
                message.success('已重新启动');
                loadProject();
              } catch { message.error('重试失败'); }
            }}>重试</Button>
          )}
        </Space>
      </div>

      {/* Project Info Bar */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="large">
          <Text>📖 <strong>{project.course}</strong></Text>
          <Text>🎯 难度 {project.difficulty.basic}/{project.difficulty.medium}/{project.difficulty.hard}</Text>
          <Text>📄 {project.nSets} 套</Text>
          <Text>📦 {project.outputType}</Text>
          <Text>🔍 {project.verifyMode}</Text>
          {project.scope && <Text>📋 范围: {project.scope}</Text>}
        </Space>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* Left: Steps */}
        <Card size="small" title="流程进度">
          <Steps
            direction="vertical"
            size="small"
            current={currentStep}
            status={project.status === 'error' ? 'error' : 'process'}
            items={stepItems.map((item, i) => {
              // Checkpoint indicators
              if (i === 2) return { ...item, description: renderCheckpointActions('blueprint', '细目表') || item.description };
              if (i === 3) return { ...item, description: renderCheckpointActions('template', '模板') || item.description };
              if (i === 6) return { ...item, description: renderCheckpointActions('selection', '选卷') || item.description };
              return item;
            })}
          />
        </Card>

        {/* Right: Main content area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Alert for waiting checkpoints */}
          {isWaitingOnCheckpoint && (
            <Alert
              type="warning"
              showIcon
              message="需要您的确认"
              description="请检查上面的中间产物，确认无误后点击「确认」继续流程。如有问题请点击「驳回」并附注修改意见。"
            />
          )}
          {project.status === 'error' && (
            <Alert type="error" showIcon message="流程出错" description="请查看下方日志了解详情，可点击重试按钮重新执行当前步骤。" />
          )}

          {/* Files section */}
          {project.files && project.files.length > 0 && (
            <Card size="small" title="📁 产物文件">
              <List
                size="small"
                dataSource={project.files}
                renderItem={(file) => (
                  <List.Item
                    actions={[
                      <Button
                        key="download" type="link" size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => {
                          const token = localStorage.getItem('token');
                          // Direct download with auth
                          const link = document.createElement('a');
                          link.href = `/api/projects/${projectId}/download/${file.id}`;
                          link.download = file.filename;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                      >
                        下载
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<FileTextOutlined />}
                      title={file.filename}
                      description={<Tag>{file.type}</Tag>}
                    />
                  </List.Item>
                )}
              />
            </Card>
          )}

          {/* Events Log */}
          <Card size="small" title="📋 运行日志" extra={
            <Text type="secondary" style={{ fontSize: 12 }}>实时更新</Text>
          }>
            <div style={{
              maxHeight: 300, overflow: 'auto', background: '#1e1e1e',
              borderRadius: 6, padding: 12, fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 13, color: '#d4d4d4', lineHeight: 1.6,
            }}>
              {events.length === 0 ? (
                <Text style={{ color: '#888' }}>等待事件...</Text>
              ) : (
                events.map((evt, i) => (
                  <div key={evt.id || i} style={{
                    color: evt.eventType === 'error' ? '#f48771' :
                           evt.eventType === 'done' ? '#89d185' :
                           evt.eventType === 'progress' ? '#75beff' : '#d4d4d4',
                  }}>
                    <Text style={{ color: '#666', marginRight: 8 }}>
                      [{new Date(evt.createdAt).toLocaleTimeString()}]
                    </Text>
                    <Text style={{ color: '#569cd6' }}>[{evt.step}]</Text>
                    {' '}{evt.message}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

function statusToStepForCheckpoint(step: string): number {
  if (step === 'blueprint') return 2;
  if (step === 'template') return 3;
  if (step === 'selection') return 6;
  return 99;
}

export default ProjectWorkspace;
