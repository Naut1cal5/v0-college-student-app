import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Test connection function
export async function testConnection() {
  try {
    const { data, error } = await supabase.from("users").select("count").limit(1)
    if (error) {
      console.error("Supabase connection error:", error)
      return false
    }
    console.log("Supabase connection successful")
    return true
  } catch (error) {
    console.error("Supabase connection failed:", error)
    return false
  }
}

// College domains for verification
export const COLLEGE_DOMAINS = ["edu", "ac.uk", "university.edu", "college.edu", "student.edu"]

export function isCollegeEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase()
  return COLLEGE_DOMAINS.some((collegeDomain) => domain?.endsWith(collegeDomain) || domain?.includes(".edu"))
}

export function getCollegeDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() || ""
}
