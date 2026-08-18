import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Steps, Button, Typography, Tag, Space, Spin, Alert, Descriptions,
  List, Divider, message, Empty, Collapse, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined,
  PlayCircleOutlined, DownloadOutlined, FileTextOutlined,
  ReloadOutlined, QuestionCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import { getProject, approveCheckpoint, startWorkflow, getBlueprint, getTemplateData } from '../services/project';
import type { BlueprintResponse, TemplateResponse } from '../services/project';
import type { ProjectDetail, JobEvent, Checkpoint } from '@exam-maker/shared';

const { Title, Text, Paragraph } = Typography;

// Build an authenticated download URL (EventSource/<a> can't set headers, so pass token as query param)
function downloadUrl(projectId: number, fileId: number): string {
  const token = localStorage.getItem('token');
  return `/api/projects/${projectId}/download/${fileId}?token=${encodeURIComponent(token || '')}`;
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

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
    assigning: 4, generating: 5, compiling: 6, done: 6, error: -1,
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
  const [blueprint, setBlueprint] = useState<BlueprintResponse | null>(null);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [template, setTemplate] = useState<TemplateResponse | null>(null);

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

  // Load blueprint when project enters blueprinting or later
  useEffect(() => {
    if (project && ['blueprinting', 'templating', 'generating', 'compiling', 'done'].includes(project.status)) {
      setBlueprintLoading(true);
      getBlueprint(projectId).then(bp => {
        setBlueprint(bp);
      }).catch(() => {
        setBlueprint(null);
      }).finally(() => setBlueprintLoading(false));
    }
  }, [project?.status, projectId]);

  // Load template when project enters templating or later
  useEffect(() => {
    if (project && ['templating', 'assigning', 'generating', 'compiling', 'done'].includes(project.status)) {
      getTemplateData(projectId).then(tmpl => {
        setTemplate(tmpl);
      }).catch(() => {
        setTemplate(null);
      });
    }
  }, [project?.status, projectId]);

  // SSE stream for real-time events (token passed as query param since EventSource can't set headers)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const url = `/api/projects/${projectId}/events?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const evt = JSON.parse(event.data) as JobEvent;
        setEvents((prev) => {
          const withoutDuplicate = prev.filter(existing => existing.id !== evt.id);
          return [...withoutDuplicate, evt].slice(-200);
        });
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
            使用当前{label}继续
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
          {(['drafting', 'parsing'].includes(project.status)) && (
            <Button type="primary" icon={<PlayCircleOutlined />}
              loading={actionLoading === 'start'}
              onClick={async () => {
                setActionLoading('start');
                try {
                  await startWorkflow(projectId);
                  message.success(project.status === 'parsing' ? '已开始解析真题并出卷' : '工作流已启动');
                  await loadProject();
                } catch { message.error('启动失败'); }
                finally { setActionLoading(null); }
              }}
            >
              {project.status === 'parsing' ? '开始解析并出卷' : '开始出卷'}
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
              description="流程已暂停。请检查细目表或试卷模板；无需修改时点击「使用当前配置继续」，系统才会进入下一阶段。如有问题请点击「驳回」。"
            />
          )}
          {project.status === 'error' && (
            <Alert type="error" showIcon message="流程出错" description="请查看下方日志了解详情，可点击重试按钮重新执行当前步骤。" />
          )}

          {/* Blueprint section */}
          {blueprint && blueprint.entries && blueprint.entries.length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  📊 双向细目表
                  <Tag color="blue">{blueprint.entries.length} 题</Tag>
                </Space>
              }
              extra={
                <Button type="link" size="small"
                  onClick={() => {
                    // Download blueprint.md
                    const bpFile = project.files?.find(f => f.filename === 'blueprint.md');
                    if (bpFile) {
                      triggerDownload(downloadUrl(projectId, bpFile.id), 'blueprint.md');
                    }
                  }}
                >下载 Markdown</Button>
              }
            >
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                {/* Difficulty Summary Bar */}
                <div style={{ marginBottom: 16 }}>
                  <Text strong>难度分布：</Text>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {blueprint.entries.length > 0 && (() => {
                      const totalPoints = blueprint.entries.reduce((s: number, e) => s + e.points, 0);
                      // Source papers may omit scores. In that case show the distribution by
                      // question count instead of dividing zero source points and rendering NaN.
                      const weight = (entry: BlueprintResponse['entries'][number]) => totalPoints > 0 ? entry.points : 1;
                      const totalWeight = blueprint.entries.reduce((s, entry) => s + weight(entry), 0);
                      const basicPoints = blueprint.entries.filter(e => e.difficulty === '基础').reduce((s, e) => s + weight(e), 0);
                      const mediumPoints = blueprint.entries.filter(e => e.difficulty === '中等').reduce((s, e) => s + weight(e), 0);
                      const hardPoints = blueprint.entries.filter(e => e.difficulty === '难').reduce((s, e) => s + weight(e), 0);
                      type DiffItem = { label: string; pct: number; color: string };
                      const items: DiffItem[] = [
                        { label: '基础', pct: Math.round(basicPoints / totalWeight * 100), color: '#52c41a' },
                        { label: '中等', pct: Math.round(mediumPoints / totalWeight * 100), color: '#faad14' },
                        { label: '难', pct: Math.round(hardPoints / totalWeight * 100), color: '#f5222d' },
                      ];
                      return items.map(d => (
                        <div key={d.label} style={{
                          flex: d.pct, background: d.color, color: '#fff',
                          textAlign: 'center', padding: '4px 0', borderRadius: 4,
                          fontSize: 13, minWidth: 60,
                        }}>
                          {d.label} {d.pct}%
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* KP Summary */}
                <div style={{ marginBottom: 12 }}>
                  <Text strong>考点清单：</Text>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {(() => {
                      const kpCounts = new Map<string, number>();
                      blueprint.entries.forEach(e => {
                        e.kp.forEach(k => kpCounts.set(k, (kpCounts.get(k) || 0) + 1));
                      });
                      return [...kpCounts.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([kp, freq], i) => (
                          <Tag key={kp} color={freq >= 2 ? 'blue' : 'default'}>
                            K{i + 1}: {kp}{freq >= 2 ? ' ⭐' : ''}
                          </Tag>
                        ));
                    })()}
                  </div>
                </div>

                {/* Question Mapping Table */}
                <Text strong>逐题考点映射：</Text>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
                    <thead>
                      <tr style={{ background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>题号</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>题型</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>分值</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>考点</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>难度</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>认知层次</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>设问范式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blueprint.entries.map((e, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '4px 8px' }}>{e.no}</td>
                          <td style={{ padding: '4px 8px' }}>{e.type}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>{e.points}</td>
                          <td style={{ padding: '4px 8px' }}>{e.kp.join('、')}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                            <Tag color={e.difficulty === '基础' ? 'success' : e.difficulty === '中等' ? 'warning' : 'error'}
                              style={{ margin: 0, fontSize: 11 }}>
                              {e.difficulty}
                            </Tag>
                          </td>
                          <td style={{ padding: '4px 8px' }}>{e.cognition}</td>
                          <td style={{ padding: '4px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={e.stem_kind}>{e.stem_kind}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {blueprint.entries[0]?.note?.includes('启发式') && (
                  <Alert type="warning" showIcon style={{ marginTop: 12 }}
                    message="当前为启发式分析结果，设置 ANTHROPIC_API_KEY 后可启用 AI 深度考点分析" />
                )}
              </div>
            </Card>
          )}

          {/* Template section */}
          {template && template.template && template.template.sections.length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  📐 试卷模板
                  <Tag color={template.template.verified ? 'success' : 'warning'}>
                    {template.template.verified ? '✅ 已核对' : '⚠ 待审核'}
                  </Tag>
                </Space>
              }
            >
              {/* Summary bar */}
              <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Tag color="blue">总分: {template.template.totalScore}分</Tag>
                <Tag color="blue">时长: {template.template.duration}分钟</Tag>
                <Tag>{template.template.sections.length} 种题型</Tag>
                <Tag>
                  共 {template.template.sections.reduce((a: number, s) => a + s.count, 0)} 题
                </Tag>
              </div>

              {/* Section structure */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>序号</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>题型</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>题量</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>单题分值</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>小计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.template.sections.map((s) => {
                      const expected = s.count * s.pointsPerQuestion;
                      const matched = Math.abs(s.subtotal - expected) < 0.5;
                      return (
                        <tr key={s.index} style={{
                          borderBottom: '1px solid #f0f0f0',
                          background: matched ? 'transparent' : '#fff7e6',
                        }}>
                          <td style={{ padding: '6px 12px', textAlign: 'center' }}>{s.index}</td>
                          <td style={{ padding: '6px 12px' }}><strong>{s.type}</strong></td>
                          <td style={{ padding: '6px 12px', textAlign: 'center' }}>{s.count}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'center' }}>{s.pointsPerQuestion}</td>
                          <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 'bold' }}>
                            {s.subtotal}
                            {!matched && (
                              <Tooltip title={`期望 ${s.count} × ${s.pointsPerQuestion} = ${expected}`}>
                                <WarningOutlined style={{ color: '#faad14', marginLeft: 6 }} />
                              </Tooltip>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid #e8e8e8', fontWeight: 'bold' }}>
                      <td colSpan={4} style={{ padding: '8px 12px', textAlign: 'right' }}>合计</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {template.template.sections.reduce((a: number, s) => a + s.subtotal, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Score check */}
              <div style={{ marginTop: 12, fontSize: 13 }}>
                {template.template.sections.reduce((a: number, s) => a + s.subtotal, 0) === template.template.totalScore ? (
                  <Tag color="success">✅ 分值核对: Σ各节小计 = 总分 {template.template.totalScore}</Tag>
                ) : (
                  <Tag color="error">⚠ 分值偏差: 小计 {template.template.sections.reduce((a: number, s) => a + s.subtotal, 0)} ≠ 总分 {template.template.totalScore}</Tag>
                )}
              </div>
            </Card>
          )}

          {/* Generated Papers section */}
          {project.files && project.files.filter(f => f.type === 'generated_paper').length > 0 && (() => {
            const papers = project.files.filter(f => f.type === 'generated_paper').sort((a, b) => a.filename.localeCompare(b.filename));
            return (
            <Card size="small" title={
              <Space>
                📄 生成试卷
                <Tag color="green">{papers.length} 套</Tag>
              </Space>
            }>
              <div>
                {papers.map((file) => (
                  <div key={file.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <Space>
                      <FileTextOutlined style={{ color: '#1677ff' }} />
                      <span>{file.filename}</span>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(file.createdAt).toLocaleTimeString()}
                      </Text>
                    </Space>
                    <Button type="link" size="small" icon={<DownloadOutlined />}
                      onClick={() => triggerDownload(downloadUrl(projectId, file.id), file.filename)}>
                      下载
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
            );
          })()}

          {/* Teacher delivery artifacts */}
          {project.files && project.files.some(f =>
            ['student_paper', 'answer_key', 'rubric'].includes(f.type) ||
            (f.type === 'final_output' && ['question_paper', 'answer_key', 'rubric'].includes(String(f.metadata?.artifactType)))
          ) && (() => {
            const artifacts = project.files
              .filter(f =>
                ['student_paper', 'answer_key', 'rubric'].includes(f.type) ||
                (f.type === 'final_output' && ['question_paper', 'answer_key', 'rubric'].includes(String(f.metadata?.artifactType)))
              )
              .sort((a, b) => a.filename.localeCompare(b.filename));
            const labels: Record<string, string> = {
              student_paper: '学生卷', question_paper: '学生卷', answer_key: '教师参考答案', rubric: '逐项评分标准',
            };
            return (
              <Card size="small" title="📦 教师交付制品">
                <List
                  size="small"
                  dataSource={artifacts}
                  renderItem={(file) => (
                    <List.Item actions={[
                      <Button key="download" type="link" size="small" icon={<DownloadOutlined />}
                        onClick={() => {
                          const token = localStorage.getItem('token');
                          const link = document.createElement('a');
                          link.href = `/api/projects/${projectId}/download/${file.id}?token=${encodeURIComponent(token || '')}`;
                          link.download = file.filename;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}>
                        下载
                      </Button>,
                    ]}>
                      <List.Item.Meta
                        avatar={<FileTextOutlined />}
                        title={file.filename}
                        description={(() => {
                          const artifactType = file.type === 'final_output' ? String(file.metadata?.artifactType) : file.type;
                          return <Space>
                            <Tag color={artifactType === 'question_paper' || artifactType === 'student_paper' ? 'blue' : 'purple'}>
                              {labels[artifactType] || artifactType}
                            </Tag>
                            <Tag>{String(file.metadata?.format || file.filename.split('.').pop() || '').toUpperCase()}</Tag>
                          </Space>;
                        })()}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            );
          })()}

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
                        onClick={() => triggerDownload(downloadUrl(projectId, file.id), file.filename)}
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
