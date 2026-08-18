import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Input, Modal, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, ImportOutlined, UserAddOutlined } from '@ant-design/icons';
import type { EnrollmentStudent, StudentSearchResult, TeachingClassDetail as Detail } from '@exam-maker/shared';
import { addClassStudents, getTeachingClass, importClassStudents, removeClassStudent, searchClassStudents } from '../services/teachingClass';

const { Title, Text } = Typography;
function errorText(error: unknown) { return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '操作失败'; }

const TeachingClassDetail: React.FC = () => {
  const classId = Number(useParams().id);
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [candidates, setCandidates] = useState<StudentSearchResult[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [identifiers, setIdentifiers] = useState('');
  const load = async () => { setLoading(true); try { setDetail(await getTeachingClass(classId)); } catch (error) { message.error(errorText(error)); navigate('/classes'); } finally { setLoading(false); } };
  useEffect(() => { if (Number.isInteger(classId) && classId > 0) void load(); else navigate('/classes'); }, [classId]);

  const searchStudents = async (q = '') => { try { setCandidates(await searchClassStudents(classId, q)); } catch (error) { message.error(errorText(error)); } };
  const add = async () => { try { const result = await addClassStudents(classId, selected); message.success(`新增 ${result.added.length} 人，恢复 ${result.restored.length} 人`); setAddOpen(false); setSelected([]); await load(); } catch (error) { message.error(errorText(error)); } };
  const importStudents = async () => {
    const values = identifiers.split(/[\n,;，；]+/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) { message.warning('请输入用户名或邮箱'); return; }
    try { const result = await importClassStudents(classId, values); message.success(`新增 ${result.added.length} 人，恢复 ${result.restored.length} 人`); if (result.missing.length) message.warning(`未找到：${result.missing.join('、')}`); setImportOpen(false); setIdentifiers(''); await load(); } catch (error) { message.error(errorText(error)); }
  };
  const remove = (student: EnrollmentStudent) => Modal.confirm({ title: `移出学生“${student.username}”？`, content: '账号和历史考试数据不会删除。', okText: '移出', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { try { await removeClassStudent(classId, student.id); message.success('学生已移出班级'); await load(); } catch (error) { message.error(errorText(error)); } } });

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!detail) return null;
  const active = detail.students.filter((item) => item.enrollmentStatus === 'active');
  return <div>
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/classes')} style={{ marginBottom: 16 }}>返回班级</Button>
    <Card style={{ marginBottom: 16 }}><Space direction="vertical"><Space><Title level={3} style={{ margin: 0 }}>{detail.name}</Title><Tag color={detail.status === 'active' ? 'green' : 'orange'}>{detail.status === 'active' ? '进行中' : '已归档'}</Tag></Space><Text type="secondary">{detail.courseName} · {detail.semester || '未设置学期'} · {active.length} 名学生</Text></Space></Card>
    {detail.status === 'archived' && <Alert type="warning" showIcon message="班级已归档，不能继续添加成员。" style={{ marginBottom: 16 }} />}
    <Card title="学生列表" extra={<Space><Button icon={<ImportOutlined />} disabled={detail.status === 'archived'} onClick={() => setImportOpen(true)}>批量导入</Button><Button type="primary" icon={<UserAddOutlined />} disabled={detail.status === 'archived'} onClick={() => { setAddOpen(true); void searchStudents(); }}>添加学生</Button></Space>}>
      <Table<EnrollmentStudent> rowKey="enrollmentId" dataSource={active} columns={[
        { title: '用户名', dataIndex: 'username' }, { title: '邮箱', dataIndex: 'email' },
        { title: '加入时间', dataIndex: 'joinedAt', render: (value) => new Date(value).toLocaleString('zh-CN') },
        { title: '课程考试', key: 'exam', render: (_, item) => `${item.completedExamCount}/${item.examCount} 已完成` },
        { title: '操作', key: 'action', render: (_, item) => <Button danger icon={<DeleteOutlined />} onClick={() => remove(item)}>移出</Button> },
      ]} />
    </Card>
    <Modal title="添加已有学生账号" open={addOpen} onCancel={() => setAddOpen(false)} onOk={add} okButtonProps={{ disabled: !selected.length }} okText="添加" cancelText="取消">
      <Select mode="multiple" showSearch filterOption={false} onSearch={searchStudents} value={selected} onChange={setSelected} style={{ width: '100%' }} placeholder="输入用户名或邮箱搜索" options={candidates.filter((item) => item.enrollmentStatus !== 'active').map((item) => ({ value: item.id, label: `${item.username}（${item.email}）${item.enrollmentStatus === 'removed' ? ' · 已移出' : ''}` }))} />
    </Modal>
    <Modal title="批量导入已有学生" open={importOpen} onCancel={() => setImportOpen(false)} onOk={importStudents} okText="导入" cancelText="取消">
      <Text type="secondary">每行填写一个已有学生的用户名或邮箱，也支持逗号分隔。未找到的账号会明确列出，不会自动创建或复制学生数据。</Text>
      <Input.TextArea rows={8} value={identifiers} onChange={(event) => setIdentifiers(event.target.value)} placeholder={'student01\nstudent02@example.com'} style={{ marginTop: 12 }} />
    </Modal>
  </div>;
};

export default TeachingClassDetail;
