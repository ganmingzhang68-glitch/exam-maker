import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Popconfirm, Progress, Select, Space, Table, Tag, Typography, message } from 'antd';
import { EyeOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { TaskDetail, TaskStatus, TaskSummary } from '@exam-maker/shared';
import { cancelTask, getTask, listTasks, retryTask } from '../services/task';

const { Title, Text } = Typography;
const statusText: Record<TaskStatus, string> = { queued: '排队中', running: '运行中', retrying: '重试中', succeeded: '已完成', failed: '失败', cancelled: '已取消', blocked: '等待处理' };
const statusColor: Record<TaskStatus, string> = { queued: 'default', running: 'processing', retrying: 'warning', succeeded: 'success', failed: 'error', cancelled: 'default', blocked: 'warning' };

function duration(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return `${value} ms`;
  const seconds = Math.round(value / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function errorMessage(error: unknown): string {
  const value = error as { response?: { data?: { error?: string; requestId?: string } }; message?: string };
  const base = value.response?.data?.error ?? value.message ?? '操作失败';
  return value.response?.data?.requestId ? `${base}（错误编号：${value.response.data.requestId}）` : base;
}

const TaskCenter: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaskSummary[]>([]);
  const [status, setStatus] = useState<TaskStatus | undefined>();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRows(await listTasks(status)); } catch (error) { message.error(errorMessage(error)); }
    finally { setLoading(false); }
  }, [status]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!rows.some(row => ['queued', 'running', 'retrying'].includes(row.status))) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [rows, refresh]);

  const openDetail = async (row: TaskSummary) => {
    try { setDetail(await getTask(row.kind, row.id)); } catch (error) { message.error(errorMessage(error)); }
  };
  const operate = async (action: 'cancel' | 'retry', row: TaskSummary | TaskDetail) => {
    try {
      const updated = action === 'cancel' ? await cancelTask(row.kind, row.id) : await retryTask(row.kind, row.id);
      setDetail(updated); await refresh(); message.success(action === 'cancel' ? '已提交取消请求' : '已从断点提交重试');
    } catch (error) { message.error(errorMessage(error)); }
  };

  return <div style={{ maxWidth: 1400, margin: '0 auto' }}>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="start">
      <div><Title level={2} style={{ marginBottom: 4 }}>后台任务中心</Title><Text type="secondary">进度来自真实阶段状态；模型价格未配置时不会估算成本。</Text></div>
      <Space><Select allowClear placeholder="全部状态" style={{ width: 140 }} value={status} onChange={setStatus}
        options={Object.entries(statusText).map(([value, label]) => ({ value, label }))} />
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button></Space>
    </Space>
    <Card><Table rowKey="key" loading={loading} dataSource={rows} locale={{ emptyText: <Empty description="暂无后台任务" /> }}
      columns={[
        { title: '任务', dataIndex: 'name', render: (value: string, row: TaskSummary) => <><div>{value}</div><Text type="secondary">{row.kind === 'generation' ? '完整出卷' : '快速仿题'}</Text></> },
        { title: '课程', dataIndex: 'course', render: (value: string | null) => value ?? '—' },
        { title: '创建时间', dataIndex: 'createdAt' },
        { title: '状态', dataIndex: 'status', render: (value: TaskStatus) => <Tag color={statusColor[value]}>{statusText[value]}</Tag> },
        { title: '真实阶段进度', render: (_: unknown, row: TaskSummary) => <Space direction="vertical" size={0} style={{ minWidth: 150 }}><Text>{row.completedStages} / {row.totalStages} 阶段</Text><Progress percent={Math.round(row.completedStages / row.totalStages * 100)} showInfo={false} size="small" /></Space> },
        { title: '耗时', dataIndex: 'durationMs', render: duration },
        { title: '错误', dataIndex: 'error', ellipsis: true, render: (value: string | null) => value ? <Text type="danger">{value}</Text> : '—' },
        { title: '操作', fixed: 'right' as const, render: (_: unknown, row: TaskSummary) => <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => void openDetail(row)}>详情</Button>
          {['queued', 'running', 'retrying'].includes(row.status) && <Popconfirm title="取消任务？" description="当前 AI 调用完成后将停止后续阶段。" onConfirm={() => void operate('cancel', row)}><Button size="small" danger icon={<StopOutlined />}>取消</Button></Popconfirm>}
          {['failed', 'cancelled'].includes(row.status) && <Button size="small" icon={<ReloadOutlined />} onClick={() => void operate('retry', row)}>重试</Button>}
        </Space> },
      ]} scroll={{ x: 1100 }} /></Card>
    <Drawer width={720} title={detail?.name ?? '任务详情'} open={Boolean(detail)} onClose={() => setDetail(null)} extra={detail?.resultPath && <Button onClick={() => navigate(detail.resultPath!)}>打开结果</Button>}>
      {detail && <><Descriptions column={2} bordered size="small" items={[
        { key: 'status', label: '状态', children: <Tag color={statusColor[detail.status]}>{statusText[detail.status]}</Tag> },
        { key: 'progress', label: '阶段进度', children: `${detail.completedStages} / ${detail.totalStages}` },
        { key: 'request', label: 'Request ID', children: detail.requestId ?? '—' },
        { key: 'duration', label: '耗时', children: duration(detail.durationMs) },
        { key: 'model', label: '模型', children: detail.model ?? '—' },
        { key: 'tokens', label: 'Token', children: `输入 ${detail.inputTokens} / 输出 ${detail.outputTokens}` },
        { key: 'cost', label: '估算成本', span: 2, children: detail.estimatedCost === null ? detail.costNote : String(detail.estimatedCost) },
      ]} />
      {detail.error && <Alert type="error" showIcon message="任务错误" description={detail.error} style={{ marginTop: 16 }} />}
      <Title level={4} style={{ marginTop: 24 }}>阶段尝试记录</Title>
      <Table rowKey="id" pagination={false} size="small" dataSource={detail.attempts} columns={[
        { title: '阶段', dataIndex: 'stage' }, { title: '尝试', dataIndex: 'attemptNumber' },
        { title: '状态', dataIndex: 'status' }, { title: '耗时', dataIndex: 'durationMs', render: duration },
        { title: '错误', dataIndex: 'error', render: (value: string | null) => value ?? '—' },
      ]} /></>}
    </Drawer>
  </div>;
};

export default TaskCenter;
