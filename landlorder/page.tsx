1import { createClient } from '@/utils/supabase/server'
2import { cookies } from 'next/headers'
3
4export default async function Page() {
5  const cookieStore = await cookies()
6  const supabase = createClient(cookieStore)
7
8  const { data: todos } = await supabase.from('todos').select()
9
10  return (
11    <ul>
12      {todos?.map((todo) => (
13        <li key={todo.id}>{todo.name}</li>
14      ))}
15    </ul>
16  )
17}
